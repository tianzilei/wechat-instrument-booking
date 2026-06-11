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

async function isAdmin(openid) {
  if (!openid) return false
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin'
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!(await isAdmin(OPENID))) return fail('PERMISSION_DENIED', '无权限操作')

  const registrationPending = await db.collection('users').where({ registrationStatus: 'pending' }).count()
  const bookingPending = await db.collection('bookings').where({ status: 'pending_review' }).count()
  const cancelPending = await db.collection('bookings').where({ status: 'cancel_pending' }).count()
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  let monthBookings = []
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const batch = await db.collection('bookings').where({
      status: _.in(['confirmed', 'completed']),
      startAt: _.gte(monthStart),
    }).skip(skip).limit(1000).get()
    monthBookings = monthBookings.concat(batch.data)
    if (batch.data.length < 1000) hasMore = false
    else skip += batch.data.length
  }
  const monthHours = monthBookings.reduce((sum, item) => sum + (item.durationHours || 0), 0)

  return ok({
    registrationPending: registrationPending.total,
    bookingPending: bookingPending.total,
    cancelPending: cancelPending.total,
    monthHours,
  })
}
