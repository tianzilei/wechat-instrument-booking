const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ACTIVE_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming']

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

function isWholeHour(date) {
  return date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0
}

function isWeekend(date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

function getMinimumStartAt() {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  return now
}

function getWeekStart(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function getWeekEnd(weekStart) {
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 7)
  return end
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

function makeScheduleKey(segments) {
  const data = segments.map((s) => `${s.startAt.toISOString()}|${s.endAt.toISOString()}`).join(';')
  return data
}

function getSpecialReasons(segments, restrictedSlots, openStartHour, openEndHour) {
  const reasons = new Set()
  for (const s of segments) {
    if (isWeekend(s.startAt) || isWeekend(new Date(s.endAt.getTime() - 1))) reasons.add('weekend')
    const startHour = s.startAt.getHours()
    const endHour = s.endAt.getHours()
    if (startHour < openStartHour || endHour > openEndHour) reasons.add('night')
    for (const r of restrictedSlots) {
      if (s.startAt < r.endAt && s.endAt > r.startAt) reasons.add('restricted')
    }
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

async function anyBookingConflict(segments, excludeBookingId) {
  const v2Conditions = segments.map((s) => ({
    firstStartAt: _.lt(s.endAt),
    lastEndAt: _.gt(s.startAt),
  }))
  const v1Conditions = segments.map((s) => ({
    startAt: _.lt(s.endAt),
    endAt: _.gt(s.startAt),
  }))
  const allConditions = [...v2Conditions, ...v1Conditions]
  if (allConditions.length === 0) return false
  const timeFilter = allConditions.length === 1 ? allConditions[0] : _.or(allConditions)
  const query = { status: _.in(ACTIVE_STATUSES), _id: excludeBookingId ? _.neq(excludeBookingId) : _.exists(true), ...timeFilter }
  const res = await db.collection('bookings').where(query).limit(1).get()
  return res.data.length > 0
}

async function getUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  return res.data[0]
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const user = await getUser(OPENID)
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  if (user.registrationStatus !== 'approved') return fail('REGISTRATION_REQUIRED', '注册审核通过后才能预约')
  if (user.accountStatus && user.accountStatus !== 'active') return fail('ACCOUNT_SUSPENDED', '账号状态异常')

  if (!event.requestId || !event.segments || !Array.isArray(event.segments)) return fail('INVALID_PARAMS', '参数错误')
  if (event.segments.length > 10) return fail('INVALID_SEGMENTS', '单次最多预约 10 个时段')

  const existing = await db.collection('bookings').where({ requestId: event.requestId }).limit(1).get()
  if (existing.data.length > 0) {
    const b = existing.data[0]
    return ok({ bookingId: b._id, status: b.status, bookingType: b.bookingType, duplicateRequest: true })
  }

  const normalized = normalizeSegments(event.segments)
  if (!normalized) return fail('INVALID_SEGMENTS', '时段格式错误')

  const minimumStartAt = getMinimumStartAt()
  for (const s of normalized) {
    if (!isWholeHour(s.startAt) || !isWholeHour(s.endAt)) return fail('INVALID_SEGMENTS', '预约时间必须为整点')
    if (s.startAt < minimumStartAt) return fail('INVALID_SEGMENTS', '当前小时及过去时段不可预约')
    const now = new Date()
    const maxAdvance = new Date(now.getTime() + 7 * 24 * 3600000)
    if (s.startAt > maxAdvance) return fail('INVALID_SEGMENTS', '只能提前7天预约')
  }

  const weekStart = getWeekStart(normalized[0].startAt)
  const weekEnd = getWeekEnd(weekStart)
  for (const s of normalized) {
    if (s.startAt < weekStart || s.endAt > weekEnd) return fail('INVALID_SEGMENTS', '所有时段必须处于同一自然周')
  }

  const maintenance = await db.collection('maintenance_slots').where({ status: 'active' }).limit(1000).get()
  if (anyMaintenanceConflict(normalized, maintenance.data)) return fail('MAINTENANCE_CONFLICT', '任一时段命中维护')

  if (await anyBookingConflict(normalized)) return fail('BOOKING_CONFLICT', '任一时段发生占用冲突')

  const restricted = await db.collection('restricted_slots').where({ status: 'active' }).limit(1000).get()

  let openStartHour = 9
  let openEndHour = 18
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    const settings = settingsRes.data || {}
    openStartHour = settings.openStartHour || 9
    openEndHour = settings.openEndHour || 18
  } catch (err) {}

  const specialReasons = getSpecialReasons(normalized, restricted.data, openStartHour, openEndHour)
  const status = specialReasons.length > 0 ? 'pending_review' : 'confirmed'
  const bookingType = specialReasons.length > 0 ? 'special' : 'normal'
  const scheduleKey = makeScheduleKey(normalized)

  const nowServer = db.serverDate()
  const segments = normalized.map((s) => ({
    startAt: s.startAt, endAt: s.endAt, state: 'active', cancelledAt: null, cancelReasonCode: '',
  }))

  const durationHours = normalized.reduce((sum, s) => sum + (s.endAt - s.startAt) / 3600000, 0)

  if (event.remark) {
    if (event.remark.length > 500) return fail('INVALID_PARAMS', '备注不超过 500 字')
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.remark })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '备注包含违规信息')
      }
    } catch (err) {
      console.warn('msgSecCheck unavailable, proceeding:', err.errCode || err.message)
    }
  }

  const res = await db.collection('bookings').add({
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

  return ok({ bookingId: res._id, status, bookingType, specialReasons, scheduleKey })
}
