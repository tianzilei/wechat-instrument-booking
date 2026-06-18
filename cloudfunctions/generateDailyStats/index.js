const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 100

async function fetchAll(collectionName, where, fields) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection(collectionName)
      .where(where)
      .field(fields)
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
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today.getTime() - 24 * 3600000)

  const bookings = await fetchAll('bookings', {
    status: 'confirmed',
    lastEndAt: _.and(_.gte(yesterday), _.lt(today)),
  }, {
    segments: true,
    startAt: true,
    endAt: true,
  })

  let totalHours = 0
  let workingHours = 0
  let nonWorkingHours = 0
  let cancelCount = 0
  let maintenanceHours = 0

  let openStart = 9
  let openEnd = 18
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    const settings = settingsRes.data || {}
    openStart = settings.openStartHour || 9
    openEnd = settings.openEndHour || 18
  } catch (err) {}

  for (const b of bookings) {
    const segments = b.segments || [{ startAt: b.startAt, endAt: b.endAt }]
    for (const s of segments) {
      if (s.state !== 'active') continue
      const h = (new Date(s.endAt) - new Date(s.startAt)) / 3600000
      const startH = new Date(s.startAt).getHours()
      const day = new Date(s.startAt).getDay()
      if (day === 0 || day === 6 || startH < openStart || startH >= openEnd) {
        nonWorkingHours += h
      } else {
        workingHours += h
      }
      totalHours += h
    }
  }

  const cancelled = await db.collection('bookings').where({
    status: 'cancelled',
    updatedAt: _.and(_.gte(yesterday), _.lt(today)),
  }).count()
  cancelCount = cancelled.total

  const maintenance = await fetchAll('maintenance_slots', {
    status: 'active',
    startAt: _.and(_.gte(yesterday), _.lt(today)),
  }, {
    startAt: true,
    endAt: true,
  })
  maintenanceHours = maintenance.reduce((sum, m) => sum + (new Date(m.endAt) - new Date(m.startAt)) / 3600000, 0)

  const monthKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}`
  await db.collection('monthly_stats').add({
    data: {
      month: monthKey,
      date: yesterday,
      totalHours,
      workingHours,
      nonWorkingHours,
      cancelCount,
      maintenanceHours,
      createdAt: db.serverDate(),
    },
  })

  return { success: true, data: { month: monthKey, totalHours } }
}
