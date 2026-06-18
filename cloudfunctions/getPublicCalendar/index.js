const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) { return { success: true, data, error: null } }

async function getCurrentUser(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).field({ _id: true, role: true }).limit(1).get()
  return res.data[0] || null
}

function parseChinaDate(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`)
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const currentUser = await getCurrentUser(OPENID)
  const isAdmin = !!(currentUser && currentUser.role === 'admin')
  const weekStart = parseChinaDate(event.weekStartDate)
  const weekEnd = addDays(weekStart, 7)
  const activeStatuses = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']

  // V2 bookings use firstStartAt/lastEndAt and segments; keep a separate query for legacy records.
  const [bookingsRes, legacyBookingsRes, maintenanceRes, settingsRes] = await Promise.all([
    db.collection('bookings').where({
      status: _.in(activeStatuses),
      firstStartAt: _.lt(weekEnd),
      lastEndAt: _.gt(weekStart),
    }).field({
      _id: true,
      status: true,
      userId: true,
      segments: true,
      firstStartAt: true,
      lastEndAt: true,
      projectAbbrDisplayCache: true,
    }).limit(100).get(),
    db.collection('bookings').where({
      status: _.in(activeStatuses),
      startAt: _.lt(weekEnd),
      endAt: _.gt(weekStart),
    }).field({
      _id: true, status: true, userId: true, startAt: true, endAt: true, projectAbbr: true,
    }).limit(100).get(),
    db.collection('maintenance_slots').where({
      status: 'active',
      startAt: _.lt(weekEnd),
      endAt: _.gt(weekStart),
    }).field({ _id: true, startAt: true, endAt: true, status: true }).limit(100).get(),
    db.collection('settings').doc('global').get(),
  ])
  const settings = settingsRes.data || {}

  const userIds = []
  bookingsRes.data.forEach((item) => {
    if (item.userId) userIds.push(item.userId)
  })
  legacyBookingsRes.data.forEach((item) => {
    if (item.userId) userIds.push(item.userId)
  })

  const uniqueUserIds = [...new Set(userIds)]
  const userNameMap = {}
  if (isAdmin && uniqueUserIds.length > 0) {
    const userRes = await db.collection('users').where({
      _id: uniqueUserIds.length === 1 ? uniqueUserIds[0] : _.in(uniqueUserIds),
    }).field({ _id: true, name: true }).get()
    userRes.data.forEach((item) => {
      userNameMap[item._id] = item.name || ''
    })
  }

  const slots = []
  bookingsRes.data.forEach((item) => {
    const segments = Array.isArray(item.segments) && item.segments.length > 0
      ? item.segments.filter((segment) => segment.state !== 'cancelled')
      : [{ startAt: item.firstStartAt, endAt: item.lastEndAt }]
    const state = item.status === 'pending_review' ? 'pending' : 'occupied'
    segments.forEach((segment, index) => {
      slots.push({
        startAt: segment.startAt,
        endAt: segment.endAt,
        state,
        bookingId: item._id,
        projectAbbr: item.projectAbbrDisplayCache || '',
        userName: isAdmin ? (userNameMap[item.userId] || '') : '',
        publicRenderId: `${item._id}:${index}`,
      })
    })
  })

  legacyBookingsRes.data.forEach((item) => {
    slots.push({
      startAt: item.startAt,
      endAt: item.endAt,
      state: item.status === 'pending_review' ? 'pending' : 'occupied',
      bookingId: item._id,
      projectAbbr: item.projectAbbr || '',
      userName: isAdmin ? (userNameMap[item.userId] || '') : '',
      publicRenderId: item._id,
    })
  })

  maintenanceRes.data.forEach((item) => {
    slots.push({
      startAt: item.startAt, endAt: item.endAt,
      state: 'maintenance', maintenanceId: item._id, projectAbbr: '', publicRenderId: item._id,
    })
  })

  return ok({
    weekStart: event.weekStartDate,
    serverNow: new Date(),
    rulesVersion: settings.rulesVersion || 1,
    serviceMode: settings.serviceMode || 'normal',
    maxAdvanceDays: settings.maxAdvanceDays || 7,
    slots,
  })
}
