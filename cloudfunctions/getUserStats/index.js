const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 100

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

async function fetchAllUserBookings(userId) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection('bookings').where({
      userId,
      status: 'confirmed',
    })
      .field({
        firstStartAt: true,
        lastEndAt: true,
        startAt: true,
        endAt: true,
        durationHours: true,
      })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    items.push(...batch.data)
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  let openStartHour = 9
  let openEndHour = 18
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    const settings = settingsRes.data || {}
    openStartHour = settings.openStartHour || 9
    openEndHour = settings.openEndHour || 18
  } catch (err) {}

  const bookings = await fetchAllUserBookings(user._id)

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

  bookings.forEach((booking) => {
    const startAt = booking.firstStartAt || booking.startAt
    const endAt = booking.lastEndAt || booking.endAt
    const hours = booking.durationHours || ((new Date(endAt) - new Date(startAt)) / 3600000)
    totalHours += hours
    if (new Date(startAt) >= weekStart) weekHours += hours
    if (new Date(startAt) >= monthStart) monthHours += hours
    if (isWorking(startAt, openStartHour, openEndHour)) workingHours += hours
    else nonWorkingHours += hours
    const key = monthKey(startAt)
    monthlyMap[key] = (monthlyMap[key] || 0) + hours
  })

  const pending = await db.collection('bookings').where({
    userId: user._id,
    status: _.in(['pending_review', 'cancel_pending', 'rule_review_pending']),
  }).count()
  const cancelled = await db.collection('bookings').where({
    userId: user._id,
    status: _.in(['cancelled', 'maintenance_cancelled']),
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
