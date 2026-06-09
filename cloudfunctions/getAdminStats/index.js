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

function isWorking(date) {
  const d = new Date(date)
  const day = d.getDay()
  const hour = d.getHours()
  return day !== 0 && day !== 6 && hour >= 9 && hour < 18
}

async function isAdmin(openid) {
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin'
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!(await isAdmin(OPENID))) return fail('PERMISSION_DENIED', '无权限操作')
  const res = await db.collection('bookings').where({
    status: _.in(['confirmed', 'completed']),
  }).limit(1000).get()

  const byUserMap = {}
  const byMonthMap = {}
  let totalHours = 0
  let workingHours = 0
  let nonWorkingHours = 0
  res.data.forEach((booking) => {
    const hours = booking.durationHours || ((new Date(booking.endAt) - new Date(booking.startAt)) / 3600000)
    totalHours += hours
    if (isWorking(booking.startAt)) workingHours += hours
    else nonWorkingHours += hours

    if (!byUserMap[booking.userId]) {
      byUserMap[booking.userId] = {
        userId: booking.userId,
        name: booking.userName || '',
        college: booking.college || '',
        hours: 0,
      }
    }
    byUserMap[booking.userId].hours += hours

    const month = monthKey(booking.startAt)
    byMonthMap[month] = (byMonthMap[month] || 0) + hours
  })

  return ok({
    totalHours,
    workingHours,
    nonWorkingHours,
    byUser: Object.values(byUserMap).sort((a, b) => b.hours - a.hours),
    byMonth: Object.keys(byMonthMap).sort().map((month) => ({ month, hours: byMonthMap[month] })),
    byTimeType: { workingHours, nonWorkingHours },
  })
}
