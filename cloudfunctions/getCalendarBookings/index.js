const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) {
  return { success: true, data, error: null }
}

function parseChinaDate(dateText) {
  return new Date(`${dateText}T00:00:00+08:00`)
}

function addDays(date, days) {
  const target = new Date(date)
  target.setDate(target.getDate() + days)
  return target
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  const canSeeIdentity = !!user
  const isAdmin = user && user.role === 'admin'
  const weekStart = parseChinaDate(event.weekStartDate)
  const weekEnd = addDays(weekStart, 7)
  const activeStatuses = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming']

  const bookingsRes = await db.collection('bookings').where({
    status: _.in(activeStatuses),
    startAt: _.lt(weekEnd),
    endAt: _.gt(weekStart),
  }).limit(100).get()

  const maintenanceRes = await db.collection('maintenance_slots').where({
    status: 'active',
    startAt: _.lt(weekEnd),
    endAt: _.gt(weekStart),
  }).limit(100).get()

  const restrictedRes = await db.collection('restricted_slots').where({
    status: 'active',
    startAt: _.lt(weekEnd),
    endAt: _.gt(weekStart),
  }).limit(100).get()

  const items = bookingsRes.data.map((item) => ({
    type: 'booking',
    bookingId: item._id,
    status: item.status,
    startAt: item.startAt,
    endAt: item.endAt,
    displayName: canSeeIdentity ? item.userName : '',
    college: canSeeIdentity ? item.college : '',
    remark: isAdmin ? item.remark || '' : '',
  }))

  return ok({
    weekStartDate: event.weekStartDate,
    items,
    maintenanceSlots: maintenanceRes.data,
    restrictedSlots: restrictedRes.data,
  })
}
