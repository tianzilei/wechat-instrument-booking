const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ACTIVE_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']
const BOOKING_MUTEX_DOC_ID = 'booking_schedule_mutex'
const PAGE_SIZE = 100

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

function businessError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function isWriteConflictError(err) {
  const text = String((err && (err.errMsg || err.message || err.code)) || '').toLowerCase()
  return text.includes('conflict')
}

function isWholeHour(date) {
  return date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0
}

function isWeekend(date) {
  const day = date.getDay()
  return day === 0 || day === 6
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

function getWeekStart(date) {
  const value = startOfDay(date)
  const day = value.getDay()
  const diff = day === 0 ? -6 : 1 - day
  value.setDate(value.getDate() + diff)
  return value
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
    if (merged.length === 0) { merged.push(s); continue }
    const last = merged[merged.length - 1]
    if (s.startAt.getTime() <= last.endAt.getTime()) {
      if (s.endAt > last.endAt) last.endAt = s.endAt
    } else {
      merged.push(s)
    }
  }
  return merged
}

function isSingleNaturalWeek(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false
  const anchorWeekStart = getWeekStart(segments[0].startAt).getTime()
  return segments.every((segment) => {
    const endPoint = new Date(segment.endAt.getTime() - 1)
    return getWeekStart(segment.startAt).getTime() === anchorWeekStart
      && getWeekStart(endPoint).getTime() === anchorWeekStart
  })
}

function makeScheduleKey(segments) {
  const data = segments.map((s) => `${s.startAt.toISOString()}|${s.endAt.toISOString()}`).join(';')
  return data
}

function getSpecialReasons(segments, openStartHour, openEndHour) {
  const reasons = new Set()
  for (const s of segments) {
    const endPoint = new Date(s.endAt.getTime() - 1)
    if (isWeekend(s.startAt) || isWeekend(endPoint)) reasons.add('weekend')
    const startHour = s.startAt.getHours()
    const endHour = endPoint.getHours()
    if (startHour < openStartHour || endHour >= openEndHour) reasons.add('night')
  }
  return [...reasons]
}

function anyMaintenanceConflict(segments, maintenanceSlots) {
  for (const s of segments) {
    for (const m of maintenanceSlots) {
      if (s.startAt < m.endAt && s.endAt > m.startAt) return true
    }
  }
  return false
}

function getComparableSegments(segments) {
  return (segments || [])
    .map((segment) => ({
      startAt: new Date(segment.startAt),
      endAt: new Date(segment.endAt),
    }))
    .filter((segment) => segment.startAt < segment.endAt)
}

function getBookingActiveSegments(booking) {
  if (Array.isArray(booking.segments) && booking.segments.length > 0) {
    return getComparableSegments(
      booking.segments.filter((segment) => (segment.state || 'active') !== 'cancelled')
    )
  }
  return getComparableSegments([{
    startAt: booking.firstStartAt || booking.startAt,
    endAt: booking.lastEndAt || booking.endAt,
  }])
}

function hasSegmentsOverlap(leftSegments, rightSegments) {
  for (const left of leftSegments) {
    for (const right of rightSegments) {
      if (left.startAt < right.endAt && left.endAt > right.startAt) return true
    }
  }
  return false
}

function buildConflictQueryConditions(segments, sharedFilter) {
  const v2Conditions = segments.map((s) => ({
    ...sharedFilter,
    firstStartAt: _.lt(s.endAt),
    lastEndAt: _.gt(s.startAt),
  }))
  const v1Conditions = segments.map((s) => ({
    ...sharedFilter,
    startAt: _.lt(s.endAt),
    endAt: _.gt(s.startAt),
  }))
  return [...v2Conditions, ...v1Conditions]
}

async function hasPreciseBookingConflict(collectionRef, segments, sharedFilter) {
  const requestSegments = getComparableSegments(segments)
  const conditions = buildConflictQueryConditions(requestSegments, sharedFilter)
  if (conditions.length === 0) return false
  const query = conditions.length === 1 ? conditions[0] : _.or(conditions)
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const batch = await collectionRef.where(query).field({
      segments: true,
      firstStartAt: true,
      lastEndAt: true,
      startAt: true,
      endAt: true,
    }).skip(skip).limit(PAGE_SIZE).get()
    const conflictFound = batch.data.some((booking) => hasSegmentsOverlap(requestSegments, getBookingActiveSegments(booking)))
    if (conflictFound) return true
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return false
}

async function anyBookingConflict(collectionRef, segments, excludeBookingId) {
  const sharedFilter = { status: _.in(ACTIVE_STATUSES) }
  if (excludeBookingId) {
    sharedFilter._id = _.neq(excludeBookingId)
  }
  return hasPreciseBookingConflict(collectionRef, segments, sharedFilter)
}

async function anyProjectConflict(collectionRef, segments, projectId, excludeBookingId) {
  if (!projectId) return false
  const sharedFilter = { status: _.in(ACTIVE_STATUSES), projectId }
  if (excludeBookingId) {
    sharedFilter._id = _.neq(excludeBookingId)
  }
  return hasPreciseBookingConflict(collectionRef, segments, sharedFilter)
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
    return businessError('PROJECT_CHANGE_PENDING', '课题变更审核中，暂不可预约')
  }
  return null
}

async function runWithBookingMutex(holder, callback) {
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.startTransaction()
    try {
      const mutexRef = transaction.collection('system_locks').doc(BOOKING_MUTEX_DOC_ID)
      try {
        await mutexRef.get()
      } catch (err) {}
      await mutexRef.set({
        data: {
          holder,
          updatedAt: db.serverDate(),
        },
      })
      const result = await callback(transaction)
      await transaction.commit()
      return result
    } catch (err) {
      lastErr = err
      try {
        await transaction.rollback()
      } catch (rollbackErr) {}
      if (!isWriteConflictError(err) || attempt === 2) {
        throw err
      }
    }
  }
  throw lastErr || new Error('booking mutex failed')
}

async function fetchAll(collectionRef, where) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await collectionRef.where(where).skip(skip).limit(PAGE_SIZE).get()
    items.push(...batch.data)
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const user = await getUser(OPENID)
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  if (user.registrationStatus !== 'approved') return fail('REGISTRATION_REQUIRED', '注册审核通过后才能预约')
  if (user.accountStatus && user.accountStatus !== 'active') return fail('ACCOUNT_SUSPENDED', '账号状态异常')
  {
    const projectError = await ensureProjectActive(user._id, user.projectId || '')
    if (projectError) return fail(projectError.code, projectError.message)
  }

  if (!event.requestId || !event.segments || !Array.isArray(event.segments)) return fail('INVALID_PARAMS', '参数错误')

  const existing = await db.collection('bookings').where({ requestId: event.requestId }).limit(1).get()
  if (existing.data.length > 0) {
    const b = existing.data[0]
    return ok({ bookingId: b._id, status: b.status, bookingType: b.bookingType, duplicateRequest: true })
  }

  const normalized = normalizeSegments(event.segments)
  if (!normalized) return fail('INVALID_SEGMENTS', '时段格式错误')
  if (!isSingleNaturalWeek(normalized)) return fail('INVALID_SEGMENTS', '所有时段必须位于同一自然周')

  let openStartHour = 9
  let openEndHour = 18
  let maxAdvanceDays = 7
  let serviceMode = 'normal'
  let agreementVersion = '1.0'
  let privacyVersion = '1.0'
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    const settings = settingsRes.data || {}
    openStartHour = settings.openStartHour || 9
    openEndHour = settings.openEndHour || 18
    maxAdvanceDays = settings.maxAdvanceDays || 7
    serviceMode = settings.serviceMode || 'normal'
    agreementVersion = settings.serviceAgreementVersion || '1.0'
    privacyVersion = settings.privacyPolicyVersion || '1.0'
  } catch (err) {}

  if (serviceMode !== 'normal') return fail('SERVICE_UNAVAILABLE', '系统维护中，暂不支持预约')
  if ((user.agreementVersion || '') !== agreementVersion || (user.privacyVersion || '') !== privacyVersion) {
    return fail('LEGAL_ACCEPTANCE_REQUIRED', '请先同意最新协议与隐私政策')
  }

  const minimumStartAt = getMinimumStartAt()
  const maxAdvanceBoundary = getMaxAdvanceBoundary(new Date(), maxAdvanceDays)
  for (const s of normalized) {
    if (!isWholeHour(s.startAt) || !isWholeHour(s.endAt)) return fail('INVALID_SEGMENTS', '预约时间必须为整点')
    if (s.startAt < minimumStartAt) return fail('INVALID_SEGMENTS', '当前小时及过去时段不可预约')
    if (s.startAt >= maxAdvanceBoundary || s.endAt > maxAdvanceBoundary) {
      return fail('INVALID_SEGMENTS', `只能提前${maxAdvanceDays}天预约`)
    }
  }

  const specialReasons = getSpecialReasons(normalized, openStartHour, openEndHour)
  const status = specialReasons.length > 0 ? 'pending_review' : 'confirmed'
  const bookingType = specialReasons.length > 0 ? 'special' : 'normal'
  const scheduleKey = makeScheduleKey(normalized)

  const nowServer = db.serverDate()
  const segments = normalized.map((s) => ({
    startAt: s.startAt, endAt: s.endAt, state: 'active', cancelledAt: null, cancelReasonCode: '',
  }))

  const durationHours = normalized.reduce((sum, s) => sum + (s.endAt - s.startAt) / 3600000, 0)

  if (event.remark) {
    if (event.remark.length > 100) return fail('INVALID_PARAMS', '备注不超过 100 字')
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.remark })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '备注包含违规信息')
      }
    } catch (err) {
      return fail('CONTENT_CHECK_FAILED', '备注内容安全校验失败，请稍后重试')
    }
  }

  try {
    const result = await runWithBookingMutex(`create:${event.requestId}`, async (transaction) => {
      const bookingsRef = transaction.collection('bookings')
      const latestExisting = await bookingsRef.where({ requestId: event.requestId }).limit(1).get()
      if (latestExisting.data.length > 0) {
        const booking = latestExisting.data[0]
        return { duplicateRequest: true, bookingId: booking._id, status: booking.status, bookingType: booking.bookingType }
      }

      const maintenance = await fetchAll(transaction.collection('maintenance_slots'), { status: 'active' })
      if (anyMaintenanceConflict(normalized, maintenance)) {
        throw businessError('MAINTENANCE_CONFLICT', '任一时段命中维护')
      }
      if (await anyProjectConflict(bookingsRef, normalized, user.projectId || '', '')) {
        throw businessError('PROJECT_BOOKING_CONFLICT', '该时段已被本课题预约')
      }
      if (await anyBookingConflict(bookingsRef, normalized)) {
        throw businessError('BOOKING_CONFLICT', '任一时段发生占用冲突')
      }

      const bookingRes = await bookingsRef.add({
        data: {
          userId: user._id,
          projectId: user.projectId || '',
          projectAbbrDisplayCache: user.projectAbbr || '',
          projectDisplayVersion: 1,
          requestId: event.requestId,
          scheduleKey,
          segments,
          firstStartAt: segments[0].startAt,
          lastEndAt: segments[segments.length - 1].endAt,
          durationHours,
          remark: event.remark || '',
          status,
          previousStatus: '',
          bookingType,
          specialReasons,
          reviewReason: '',
          cancellationNote: '',
          terminationReasonCode: '',
          reviewedBy: '',
          createdAt: nowServer,
          updatedAt: nowServer,
        },
      })

      return { duplicateRequest: false, bookingId: bookingRes._id }
    })

    if (result.duplicateRequest) {
      return ok({
        bookingId: result.bookingId,
        status: result.status,
        bookingType: result.bookingType,
        duplicateRequest: true,
      })
    }

    return ok({ bookingId: result.bookingId, status, bookingType, specialReasons, scheduleKey })
  } catch (err) {
    console.error('createBookingV2 failed', {
      code: err && err.code ? err.code : '',
      message: err && err.message ? err.message : String(err || ''),
      requestId: event.requestId || '',
    })
    if (err && err.code) return fail(err.code, err.message)
    return fail('SYSTEM_BUSY', '系统繁忙，请稍后重试')
  }
}
