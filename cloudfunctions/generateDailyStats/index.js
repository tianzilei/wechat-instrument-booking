const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async () => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today.getTime() - 24 * 3600000)

  const bookings = await db.collection('bookings').where({
    status: 'confirmed',
    lastEndAt: _.gte(yesterday),
    lastEndAt: _.lt(today),
  }).limit(1000).get()

  let totalHours = 0
  let workingHours = 0
  let nonWorkingHours = 0
  let cancelCount = 0
  let maintenanceHours = 0

  const OPEN_START = 9
  const OPEN_END = 18

  for (const b of bookings.data) {
    const segments = b.segments || [{ startAt: b.startAt, endAt: b.endAt }]
    for (const s of segments) {
      if (s.state !== 'active') continue
      const h = (new Date(s.endAt) - new Date(s.startAt)) / 3600000
      const startH = new Date(s.startAt).getHours()
      const day = new Date(s.startAt).getDay()
      if (day === 0 || day === 6 || startH < OPEN_START || startH >= OPEN_END) {
        nonWorkingHours += h
      } else {
        workingHours += h
      }
      totalHours += h
    }
  }

  const cancelled = await db.collection('bookings').where({
    status: 'cancelled',
    updatedAt: _.gte(yesterday),
    updatedAt: _.lt(today),
  }).count()
  cancelCount = cancelled.total

  const maintenance = await db.collection('maintenance_slots').where({
    status: 'active',
    startAt: _.gte(yesterday),
    startAt: _.lt(today),
  }).limit(100).get()
  maintenanceHours = maintenance.data.reduce((sum, m) => sum + (new Date(m.endAt) - new Date(m.startAt)) / 3600000, 0)

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
