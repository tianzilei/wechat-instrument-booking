const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ACTIVE_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming']

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function checkConflict(segments) {
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!event.waitlistId || !['confirm', 'decline'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  const ref = db.collection('waitlists').doc(event.waitlistId)
  const waitlist = (await ref.get()).data
  if (!waitlist || waitlist.userId !== user._id) return fail('PERMISSION_DENIED', '无权限操作')

  const now = db.serverDate()
  if (event.action === 'decline') {
    await ref.update({ data: { status: 'cancelled', updatedAt: now } })
    return ok({ waitlistId: event.waitlistId, status: 'cancelled' })
  }

  if (waitlist.status !== 'confirming') return fail('STATE_CHANGED', '候补尚未进入确认状态')

  const segments = waitlist.segments || waitlist.occupiedSegments || [{ startAt: waitlist.startAt, endAt: waitlist.endAt }]

  const hasConflict = await checkConflict(segments)
  if (hasConflict) return fail('BOOKING_CONFLICT', '时段已被占用')

  const nowServer = db.serverDate()
  const bookingSegments = segments.map((s) => ({
    startAt: s.startAt, endAt: s.endAt, state: 'active', cancelledAt: null, cancelReasonCode: '',
  }))
  const durationHours = segments.reduce((sum, s) => sum + (new Date(s.endAt) - new Date(s.startAt)) / 3600000, 0)

  const addRes = await db.collection('bookings').add({
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
      status: 'confirmed',
      previousStatus: '',
      bookingType: 'normal',
      specialReasons: [],
      reviewReason: '',
      cancellationNote: '',
      terminationReasonCode: '',
      reviewedBy: '',
      createdAt: nowServer,
      updatedAt: nowServer,
    },
  })
  await ref.update({
    data: {
      status: 'confirmed',
      convertedBookingId: addRes._id,
      updatedAt: nowServer,
    },
  })
  return ok({ waitlistId: event.waitlistId, status: 'confirmed', bookingId: addRes._id })
}
