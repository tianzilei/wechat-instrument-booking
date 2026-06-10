const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) { return { success: true, data, error: null } }

function parseChinaDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+08:00`)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

exports.main = async (event) => {
  const weekStart = parseChinaDate(event.weekStartDate)
  const weekEnd = addDays(weekStart, 7)
  const activeStatuses = ['pending_review', 'confirmed', 'cancel_pending']

  const bookingsRes = await db.collection('bookings').where({
    status: _.in(activeStatuses),
    startAt: _.lt(weekEnd),
    endAt: _.gt(weekStart),
  }).field({
    _id: true, status: true, startAt: true, endAt: true, projectAbbr: true,
  }).limit(100).get()

  const maintenanceRes = await db.collection('maintenance_slots').where({
    status: 'active',
    startAt: _.lt(weekEnd),
    endAt: _.gt(weekStart),
  }).field({ _id: true, startAt: true, endAt: true, status: true }).limit(100).get()

  const restrictedRes = await db.collection('restricted_slots').where({
    status: 'active',
    startAt: _.lt(weekEnd),
    endAt: _.gt(weekStart),
  }).field({ _id: true, startAt: true, endAt: true, status: true }).limit(100).get()

  const settingsRes = await db.collection('settings').doc('global').get()
  const settings = settingsRes.data || {}

  const slots = bookingsRes.data.map((item) => ({
    startAt: item.startAt,
    endAt: item.endAt,
    state: item.status === 'confirmed' ? 'occupied' : 'pending',
    projectAbbr: item.projectAbbr || '',
    publicRenderId: item._id,
  }))

  maintenanceRes.data.forEach((item) => {
    slots.push({
      startAt: item.startAt, endAt: item.endAt,
      state: 'maintenance', projectAbbr: '', publicRenderId: item._id,
    })
  })

  restrictedRes.data.forEach((item) => {
    slots.push({
      startAt: item.startAt, endAt: item.endAt,
      state: 'restricted', projectAbbr: '', publicRenderId: item._id,
    })
  })

  return ok({
    weekStart: event.weekStartDate,
    serverNow: new Date(),
    rulesVersion: settings.rulesVersion || 1,
    serviceMode: settings.serviceMode || 'normal',
    slots,
  })
}
