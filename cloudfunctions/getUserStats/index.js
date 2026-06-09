const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) {
  return { success: true, data, error: null }
}

function monthKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function isWorking(date) {
  const d = new Date(date)
  const day = d.getDay()
  const hour = d.getHours()
  return day !== 0 && day !== 6 && hour >= 9 && hour < 18
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const res = await db.collection('bookings').where({
    openid: OPENID,
    status: _.in(['confirmed', 'completed']),
  }).limit(1000).get()

  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  weekStart.setHours(0, 0, 0, 0)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthlyMap = {}
  let totalHours = 0
  let weekHours = 0
  let monthHours = 0
  let workingHours = 0
  let nonWorkingHours = 0

  res.data.forEach((booking) => {
    const hours = booking.durationHours || ((new Date(booking.endAt) - new Date(booking.startAt)) / 3600000)
    totalHours += hours
    if (new Date(booking.startAt) >= weekStart) weekHours += hours
    if (new Date(booking.startAt) >= monthStart) monthHours += hours
    if (isWorking(booking.startAt)) workingHours += hours
    else nonWorkingHours += hours
    const key = monthKey(booking.startAt)
    monthlyMap[key] = (monthlyMap[key] || 0) + hours
  })

  const pending = await db.collection('bookings').where({
    openid: OPENID,
    status: _.in(['pending_review', 'cancel_pending']),
  }).count()
  const cancelled = await db.collection('bookings').where({
    openid: OPENID,
    status: 'cancelled',
  }).count()

  return ok({
    totalHours,
    weekHours,
    monthHours,
    workingHours,
    nonWorkingHours,
    pendingCount: pending.total,
    cancelledCount: cancelled.total,
    monthlyTrend: Object.keys(monthlyMap).sort().map((month) => ({ month, hours: monthlyMap[month] })),
  })
}
