const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ACTIVE_WAITLIST_STATUSES = ['waitlisted', 'confirming']
const ACTIVE_BOOKING_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

function businessError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function normalizeSegments(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const sorted = raw
    .map((s) => ({ startAt: new Date(s.startAt), endAt: new Date(s.endAt) }))
    .filter((s) => s.startAt < s.endAt)
    .sort((a, b) => a.startAt - b.startAt)
  if (sorted.length === 0) return null

  const merged = []
  for (const s of sorted) {
    if (merged.length === 0) {
      merged.push(s)
      continue
    }
    const last = merged[merged.length - 1]
    if (s.startAt.getTime() <= last.endAt.getTime()) {
      if (s.endAt > last.endAt) last.endAt = s.endAt
    } else {
      merged.push(s)
    }
  }
  return merged
}

function makeScheduleKey(segments) {
  return segments.map((s) => `${s.startAt.toISOString()}|${s.endAt.toISOString()}`).join(';')
}

function isWholeHour(date) {
  return date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0
}

function startOfDay(date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function getMinimumStartAt() {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  return now
}

function getMaxAdvanceBoundary(now, maxAdvanceDays) {
  const boundary = startOfDay(now)
  boundary.setDate(boundary.getDate() + maxAdvanceDays + 1)
  return boundary
}

async function getUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  return res.data[0]
}

async function ensureProjectActive(userId, projectId) {
  if (!projectId) return businessError('PROJECT_INACTIVE', '请先绑定可用课题')
  const [projectRes, pendingChangeRes] = await Promise.all([
    db.collection('projects').doc(projectId).field({ status: true }).get(),
    db.collection('project_applications').where({ userId, status: 'pending' }).limit(1).get(),
  ])
  const project = projectRes.data
  if (!project || project.status !== 'active') {
    return businessError('PROJECT_INACTIVE', '课题不可用')
  }
  if (pendingChangeRes.data.length > 0) {
    return businessError('PROJECT_CHANGE_PENDING', '课题变更审核中，暂不可加入候补')
  }
  return null
}

async function hasDuplicateWaitlist(userId, scheduleKey) {
  const res = await db.collection('waitlists').where({
    userId,
    scheduleKey,
    status: _.in(ACTIVE_WAITLIST_STATUSES),
  }).limit(1).get()
  return res.data[0] || null
}

async function hasBookingConflict(segments) {
  const conditions = segments.map((s) => ({
    status: _.in(ACTIVE_BOOKING_STATUSES),
    firstStartAt: _.lt(s.endAt),
    lastEndAt: _.gt(s.startAt),
  }))
  if (conditions.length === 0) return false
  const query = conditions.length === 1 ? conditions[0] : _.or(conditions)
  const res = await db.collection('bookings').where(query).limit(1).get()
  return res.data.length > 0
}

async function hasMaintenanceConflict(segments) {
  const conditions = segments.map((s) => ({
    status: 'active',
    startAt: _.lt(s.endAt),
    endAt: _.gt(s.startAt),
  }))
  if (conditions.length === 0) return false
  const query = conditions.length === 1 ? conditions[0] : _.or(conditions)
  const res = await db.collection('maintenance_slots').where(query).limit(1).get()
  return res.data.length > 0
}

async function getNextQueueOrder(scheduleKey) {
  const res = await db.collection('waitlists').where({
    scheduleKey,
    status: _.in(ACTIVE_WAITLIST_STATUSES),
  }).orderBy('queueOrder', 'desc').limit(1).get()
  const latest = res.data[0]
  return latest && typeof latest.queueOrder === 'number' ? latest.queueOrder + 1 : 1
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const user = await getUser(OPENID)
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  if (user.registrationStatus !== 'approved') return fail('REGISTRATION_REQUIRED', '注册审核通过后才能加入候补')
  if (user.accountStatus && user.accountStatus !== 'active') return fail('ACCOUNT_SUSPENDED', '账号状态异常')
  {
    const projectError = await ensureProjectActive(user._id, user.projectId || '')
    if (projectError) return fail(projectError.code, projectError.message)
  }

  if (!event.segments || !Array.isArray(event.segments)) return fail('INVALID_PARAMS', '参数错误')
  const normalized = normalizeSegments(event.segments)
  if (!normalized) return fail('INVALID_SEGMENTS', '时段格式错误')

  let maxAdvanceDays = 7
  let serviceMode = 'normal'
  let agreementVersion = '1.0'
  let privacyVersion = '1.0'
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    const settings = settingsRes.data || {}
    maxAdvanceDays = settings.maxAdvanceDays || 7
    serviceMode = settings.serviceMode || 'normal'
    agreementVersion = settings.serviceAgreementVersion || '1.0'
    privacyVersion = settings.privacyPolicyVersion || '1.0'
  } catch (err) {}

  if (serviceMode !== 'normal') return fail('SERVICE_UNAVAILABLE', '系统维护中，暂不支持候补')
  if ((user.agreementVersion || '') !== agreementVersion || (user.privacyVersion || '') !== privacyVersion) {
    return fail('LEGAL_ACCEPTANCE_REQUIRED', '请先同意最新协议与隐私政策')
  }

  const minimumStartAt = getMinimumStartAt()
  const maxAdvanceBoundary = getMaxAdvanceBoundary(new Date(), maxAdvanceDays)
  for (const s of normalized) {
    if (!isWholeHour(s.startAt) || !isWholeHour(s.endAt)) return fail('INVALID_SEGMENTS', '候补时间必须为整点')
    if (s.startAt < minimumStartAt) return fail('INVALID_SEGMENTS', '当前小时及过去时段不可候补')
    if (s.startAt >= maxAdvanceBoundary || s.endAt > maxAdvanceBoundary) {
      return fail('INVALID_SEGMENTS', `只能提前${maxAdvanceDays}天候补`)
    }
  }

  const remark = event.remark || ''
  if (remark) {
    if (remark.length > 100) return fail('INVALID_PARAMS', '备注不超过 100 字')
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: remark })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '备注包含违规信息')
      }
    } catch (err) {
      return fail('CONTENT_CHECK_FAILED', '备注内容安全校验失败，请稍后重试')
    }
  }

  const scheduleKey = makeScheduleKey(normalized)
  const duplicate = await hasDuplicateWaitlist(user._id, scheduleKey)
  if (duplicate) {
    return ok({ waitlistId: duplicate._id, status: duplicate.status, queueOrder: duplicate.queueOrder, duplicateRequest: true })
  }

  if (await hasMaintenanceConflict(normalized)) return fail('MAINTENANCE_CONFLICT', '该时段正在维护，不能加入候补')
  if (!await hasBookingConflict(normalized)) return fail('SLOT_AVAILABLE', '该时段当前可预约，请直接预约')

  try {
    const queueOrder = await getNextQueueOrder(scheduleKey)
    const segments = normalized.map((s) => ({
      startAt: s.startAt,
      endAt: s.endAt,
      state: 'active',
    }))
    const res = await db.collection('waitlists').add({
      data: {
        userId: user._id,
        projectId: user.projectId || '',
        projectAbbrDisplayCache: user.projectAbbr || '',
        scheduleKey,
        segments,
        occupiedSegments: segments,
        startAt: segments[0].startAt,
        endAt: segments[segments.length - 1].endAt,
        remark,
        status: 'waitlisted',
        queueOrder,
        confirmDeadlineAt: null,
        convertedBookingId: '',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    })
    return ok({ waitlistId: res._id, status: 'waitlisted', queueOrder, scheduleKey })
  } catch (err) {
    if (err && err.code) return fail(err.code, err.message)
    return fail('SYSTEM_BUSY', '系统繁忙，请稍后重试')
  }
}
