const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
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
  const addRes = await db.collection('bookings').add({
    data: {
      userId: user._id,
      userName: user.name || '',
      projectAbbr: user.projectAbbr || '',
      startAt: waitlist.startAt,
      endAt: waitlist.endAt,
      occupiedSegments: waitlist.occupiedSegments || [{ startAt: waitlist.startAt, endAt: waitlist.endAt }],
      durationHours: (new Date(waitlist.endAt) - new Date(waitlist.startAt)) / 3600000,
      remark: waitlist.remark || '',
      status: 'confirmed',
      bookingType: 'normal',
      specialReasons: [],
      createdAt: now,
      updatedAt: now,
    },
  })
  await ref.update({
    data: {
      status: 'confirmed',
      convertedBookingId: addRes._id,
      updatedAt: now,
    },
  })
  return ok({ waitlistId: event.waitlistId, status: 'confirmed', bookingId: addRes._id })
}
