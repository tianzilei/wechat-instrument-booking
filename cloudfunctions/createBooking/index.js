const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ACTIVE_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming']
const OPEN_START_HOUR = 9
const OPEN_END_HOUR = 18

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

function isWholeHour(date) {
  return date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0
}

function isWeekend(date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

function getSpecialReasons(startAt, endAt, restrictedSlots) {
  const reasons = []
  if (isWeekend(startAt) || isWeekend(new Date(endAt.getTime() - 1))) reasons.push('weekend')
  if (startAt.getHours() < OPEN_START_HOUR || endAt.getHours() > OPEN_END_HOUR || endAt.getHours() <= OPEN_START_HOUR) reasons.push('night')
  if (restrictedSlots.length > 0) reasons.push('restricted')
  return reasons
}

async function getCurrentUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  return res.data[0]
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const user = await getCurrentUser(OPENID)
  if (!user || user.registrationStatus !== 'approved') return fail('REGISTRATION_REQUIRED', '注册审核通过后才能预约')

  const startAt = new Date(event.startAt)
  const endAt = new Date(event.endAt)
  if (!(startAt < endAt) || !isWholeHour(startAt) || !isWholeHour(endAt)) return fail('INVALID_PARAMS', '预约时间必须为整点且结束晚于开始')
  if ((endAt - startAt) < 3600000) return fail('INVALID_PARAMS', '预约最短为 1 小时')

  const now = new Date()
  const maxAdvance = new Date(now.getTime() + 7 * 24 * 3600000)
  if (startAt > maxAdvance) return fail('INVALID_PARAMS', '只能提前 7 天预约')

  const maintenance = await db.collection('maintenance_slots').where({
    status: 'active',
    startAt: _.lt(endAt),
    endAt: _.gt(startAt),
  }).limit(1).get()
  if (maintenance.data.length > 0) return fail('MAINTENANCE_BLOCKED', '该时段为维护时间，暂不可预约')

  const conflict = await db.collection('bookings').where({
    status: _.in(ACTIVE_STATUSES),
    startAt: _.lt(endAt),
    endAt: _.gt(startAt),
  }).limit(1).get()
  if (conflict.data.length > 0) return fail('TIME_CONFLICT', '该时段已被预约，可加入候补')

  const restricted = await db.collection('restricted_slots').where({
    status: 'active',
    startAt: _.lt(endAt),
    endAt: _.gt(startAt),
  }).limit(100).get()
  const specialReasons = getSpecialReasons(startAt, endAt, restricted.data)
  const status = specialReasons.length > 0 ? 'pending_review' : 'confirmed'
  const bookingType = specialReasons.length > 0 ? 'special' : 'normal'
  const nowServer = db.serverDate()
  const res = await db.collection('bookings').add({
    data: {
      userId: user._id,
      openid: OPENID,
      userName: user.name || '',
      college: user.college || '',
      startAt,
      endAt,
      occupiedSegments: [{ startAt, endAt, isWorkingHours: specialReasons.length === 0 }],
      durationHours: (endAt - startAt) / 3600000,
      remark: event.remark || '',
      status,
      bookingType,
      specialReasons,
      createdAt: nowServer,
      updatedAt: nowServer,
    },
  })

  return ok({
    bookingId: res._id,
    status,
    bookingType,
    specialReasons,
  })
}
