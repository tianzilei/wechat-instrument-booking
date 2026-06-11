const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('NOT_FOUND', '用户不存在')

  const now = db.serverDate()
  const activeBookingStatuses = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming']
  const activeWaitlistStatuses = ['waitlisted', 'waitlist_confirming']

  const cancellations = []

  const activeBookings = await db.collection('bookings').where({
    userId: user._id,
    status: _.in(activeBookingStatuses),
  }).get()
  if (activeBookings.data.length > 0) {
    await Promise.all(activeBookings.data.map((b) => db.collection('bookings').doc(b._id).update({
      data: {
        status: 'cancelled',
        cancelReason: 'account_deleted',
        updatedAt: now,
      },
    })))
    cancellations.push(`已取消 ${activeBookings.data.length} 条预约`)
  }

  const activeWaitlists = await db.collection('waitlists').where({
    userId: user._id,
    status: _.nin(['cancelled']),
  }).get()
  if (activeWaitlists.data.length > 0) {
    await Promise.all(activeWaitlists.data.map((w) => db.collection('waitlists').doc(w._id).update({
      data: {
        status: 'cancelled',
        updatedAt: now,
      },
    })))
    cancellations.push(`已取消 ${activeWaitlists.data.length} 条候补`)
  }

  const historicalBookings = await db.collection('bookings').where({
    userId: user._id,
    status: _.nin(activeBookingStatuses),
  }).get()
  if (historicalBookings.data.length > 0) {
    await Promise.all(historicalBookings.data.map((b) => db.collection('bookings').doc(b._id).update({
      data: {
        userId: '',
        userName: '',
        projectAbbr: '',
        projectAbbrDisplayCache: '',
        remark: '',
        reviewReason: '',
        cancellationNote: '',
        updatedAt: now,
      },
    })))
  }

  await db.collection('users').doc(user._id).remove()

  return ok({ deleted: true, cancellations })
}
