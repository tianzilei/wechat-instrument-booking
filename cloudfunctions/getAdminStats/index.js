const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const PAGE_SIZE = 200

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function getAdmin(openid) {
  if (!openid) return null
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin' ? user : null
}

async function fetchAllMonthlyStats() {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection('monthly_stats')
      .field({
        _id: true,
        month: true,
        date: true,
        dateKey: true,
        totalHours: true,
        workingHours: true,
        nonWorkingHours: true,
        createdAt: true,
        updatedAt: true,
      })
      .orderBy('date', 'asc')
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

function getDateKey(item) {
  if (item.dateKey) return item.dateKey
  if (item.date) {
    const value = new Date(item.date)
    if (!Number.isNaN(value.getTime())) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    }
  }
  return item._id || ''
}

function getComparableTimestamp(item) {
  const value = new Date(item.updatedAt || item.createdAt || item.date || 0).getTime()
  return Number.isNaN(value) ? 0 : value
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!(await getAdmin(OPENID))) return fail('PERMISSION_DENIED', '无权限操作')

  const dailyStats = await fetchAllMonthlyStats()
  const uniqueDailyStats = {}
  dailyStats.forEach((item) => {
    const key = getDateKey(item)
    if (!key) return
    const existing = uniqueDailyStats[key]
    if (!existing || getComparableTimestamp(item) >= getComparableTimestamp(existing)) {
      uniqueDailyStats[key] = item
    }
  })
  const byMonthMap = {}
  let totalHours = 0
  let workingHours = 0
  let nonWorkingHours = 0
  Object.values(uniqueDailyStats).forEach((item) => {
    const month = item.month || ''
    const hours = item.totalHours || 0
    totalHours += hours
    workingHours += item.workingHours || 0
    nonWorkingHours += item.nonWorkingHours || 0
    if (month) byMonthMap[month] = (byMonthMap[month] || 0) + hours
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
