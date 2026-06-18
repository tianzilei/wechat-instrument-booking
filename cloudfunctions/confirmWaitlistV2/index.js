const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  if (!event.waitlistId || !['confirm', 'decline'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')
  const waitlist = (await db.collection('waitlists').doc(event.waitlistId).get()).data
  if (!waitlist || waitlist.userId !== user._id) return fail('PERMISSION_DENIED', '无权限操作')

  if (event.action === 'decline') {
    await db.collection('waitlists').doc(event.waitlistId).update({
      data: { status: 'cancelled', updatedAt: db.serverDate() },
    })
    return ok({ waitlistId: event.waitlistId, status: 'cancelled' })
  }

  if (waitlist.status !== 'confirming') return fail('STATE_CHANGED', '候补尚未进入确认状态')

  if (waitlist.convertedBookingId) {
    return ok({ waitlistId: event.waitlistId, status: 'converted', bookingId: waitlist.convertedBookingId, duplicateRequest: true })
  }

  const segments = waitlist.segments || waitlist.occupiedSegments || [{ startAt: waitlist.startAt, endAt: waitlist.endAt }]
  const now = new Date()
  for (const s of segments) {
    const startAt = new Date(s.startAt)
    if (startAt <= now) return fail('INVALID_SEGMENTS', '时段已过期')
  }

  const hasConflict = await checkConflict(segments)
  if (hasConflict) return fail('BOOKING_CONFLICT', '时段已被占用')

  let openStartHour = 9
  let openEndHour = 18
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    const settings = settingsRes.data || {}
    openStartHour = settings.openStartHour || 9
    openEndHour = settings.openEndHour || 18
  } catch (err) {}

  const specialReasons = getSpecialReasons(segments, openStartHour, openEndHour)
  const bookingStatus = specialReasons.length > 0 ? 'pending_review' : 'confirmed'
  const bookingType = specialReasons.length > 0 ? 'special' : 'normal'

  const nowServer = db.serverDate()
  const bookingSegments = segments.map((s) => ({ startAt: s.startAt, endAt: s.endAt, state: 'active', cancelledAt: null, cancelReasonCode: '' }))
  const durationHours = segments.reduce((sum, s) => sum + (new Date(s.endAt) - new Date(s.startAt)) / 3600000, 0)

  const bookingRes = await db.collection('bookings').add({
    data: {
      userId: user._id,
      projectId: user.projectId || '',
      projectAbbrDisplayCache: user.projectAbbr || '',
      projectDisplayVersion: 1,
      scheduleKey: waitlist.scheduleKey || '',
      segments: bookingSegments,
      firstStartAt: segments[0].startAt,
      lastEndAt: segments[segments.length - 1].endAt,
      durationHours,
      remark: waitlist.remark || '',
      status: bookingStatus,
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

  await db.collection('waitlists').doc(event.waitlistId).update({
    data: {
      status: 'converted',
      convertedBookingId: bookingRes._id,
      updatedAt: nowServer,
    },
  })

  return ok({ waitlistId: event.waitlistId, status: 'converted', bookingId: bookingRes._id })
}

async function checkConflict(segments) {
  const ACTIVE_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']
  const conditions = segments.map((s) => ({
    status: _.in(ACTIVE_STATUSES),
    firstStartAt: _.lt(new Date(s.endAt)),
    lastEndAt: _.gt(new Date(s.startAt)),
  }))
  if (conditions.length === 0) return false
  if (conditions.length === 1) {
    const res = await db.collection('bookings').where(conditions[0]).limit(1).get()
    return res.data.length > 0
  }
  const res = await db.collection('bookings').where(_.or(conditions)).limit(1).get()
  return res.data.length > 0
}

function getSpecialReasons(segments, openStartHour, openEndHour) {
  const reasons = new Set()
  for (const s of segments) {
    const start = new Date(s.startAt)
    const endPoint = new Date(new Date(s.endAt).getTime() - 1)
    if (start.getDay() === 0 || start.getDay() === 6 || endPoint.getDay() === 0 || endPoint.getDay() === 6) reasons.add('weekend')
    if (start.getHours() < openStartHour || endPoint.getHours() >= openEndHour) reasons.add('night')
  }
  return [...reasons]
}
