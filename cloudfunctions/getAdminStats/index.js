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

function monthKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function isWorking(date, openStart, openEnd) {
  const d = new Date(date)
  const day = d.getDay()
  const hour = d.getHours()
  return day !== 0 && day !== 6 && hour >= openStart && hour < openEnd
}

async function isAdmin(openid) {
  if (!openid) return false
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin'
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!(await isAdmin(OPENID))) return fail('PERMISSION_DENIED', '无权限操作')

  let openStartHour = 9
  let openEndHour = 18
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    const settings = settingsRes.data || {}
    openStartHour = settings.openStartHour || 9
    openEndHour = settings.openEndHour || 18
  } catch (err) {}

  const res = await db.collection('bookings').where({
    status: _.in(['confirmed', 'completed']),
  }).limit(1000).get()

  const byMonthMap = {}
  let totalHours = 0
  let workingHours = 0
  let nonWorkingHours = 0
  res.data.forEach((booking) => {
    const hours = booking.durationHours || ((new Date(booking.endAt) - new Date(booking.startAt)) / 3600000)
    totalHours += hours
    if (isWorking(booking.startAt, openStartHour, openEndHour)) workingHours += hours
    else nonWorkingHours += hours

    const month = monthKey(booking.startAt)
    byMonthMap[month] = (byMonthMap[month] || 0) + hours
  })

  return ok({
    totalHours,
    workingHours,
    nonWorkingHours,
    byMonth: Object.keys(byMonthMap).sort().map((month) => ({ month, hours: byMonthMap[month] })),
    byTimeType: { workingHours, nonWorkingHours },
    monthCount: Object.keys(byMonthMap).length,
  })
}
