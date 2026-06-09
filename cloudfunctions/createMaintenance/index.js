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

async function getAdmin(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')
  const startAt = new Date(event.startAt)
  const endAt = new Date(event.endAt)
  if (!(startAt < endAt)) return fail('INVALID_PARAMS', '时间参数错误')

  const activeStatuses = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming']
  const conflictRes = await db.collection('bookings').where({
    status: _.in(activeStatuses),
    startAt: _.lt(endAt),
    endAt: _.gt(startAt),
  }).limit(100).get()
  const cancelledBookingIds = conflictRes.data.map((item) => item._id)
  const now = db.serverDate()
  const addRes = await db.collection('maintenance_slots').add({
    data: {
      startAt,
      endAt,
      reason: event.reason || '',
      createdBy: admin._id,
      cancelledBookingIds,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  })

  await Promise.all(cancelledBookingIds.map((bookingId) => db.collection('bookings').doc(bookingId).update({
    data: {
      status: 'cancelled',
      cancelReason: 'maintenance_cancelled',
      updatedAt: now,
    },
  })))

  return ok({ maintenanceId: addRes._id, cancelledBookingIds })
}
