const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const IN_QUERY_SIZE = 100

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getCurrentUser(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).field({
    _id: true,
    role: true,
    accountStatus: true,
    registrationStatus: true,
    projectId: true,
  }).limit(1).get()
  return res.data[0] || null
}

function isValidWeekStartDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const parts = dateStr.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  return date.getUTCFullYear() === parts[0]
    && date.getUTCMonth() === parts[1] - 1
    && date.getUTCDate() === parts[2]
}

function parseChinaDate(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`)
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function chunk(items, size) {
  const batches = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

async function fetchAll(collectionName, query, fields) {
  const items = []
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const batch = await db.collection(collectionName)
      .where(query)
      .field(fields)
      .skip(skip)
      .limit(100)
      .get()
    items.push(...batch.data)
    if (batch.data.length < 100) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

async function fetchUserMap(userIds) {
  const map = {}
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))]
  for (const ids of chunk(uniqueIds, IN_QUERY_SIZE)) {
    const batch = await db.collection('users').where({
      _id: _.in(ids),
    }).field({
      _id: true,
      name: true,
      projectId: true,
    }).get()
    batch.data.forEach((item) => {
      map[item._id] = item
    })
  }
  return map
}

function canExposeUserName(currentUser, bookingProjectId) {
  if (!currentUser) return false
  if (currentUser.role === 'admin') return true
  if ((currentUser.accountStatus || 'active') !== 'active') return false
  if (currentUser.registrationStatus !== 'approved') return false
  return !!(currentUser.projectId && bookingProjectId && currentUser.projectId === bookingProjectId)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const currentUser = await getCurrentUser(OPENID)
  const isAdmin = !!(currentUser && currentUser.role === 'admin')
  const weekStartDate = event.weekStartDate
  if (!isValidWeekStartDate(weekStartDate)) {
    return fail('INVALID_PARAMS', 'weekStartDate must be YYYY-MM-DD')
  }
  const weekStart = parseChinaDate(weekStartDate)
  const weekEnd = addDays(weekStart, 7)
  const activeStatuses = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']

  const [bookingsRes, legacyBookingsRes, maintenanceRes, settingsRes] = await Promise.all([
    fetchAll('bookings', {
      status: _.in(activeStatuses),
      firstStartAt: _.lt(weekEnd),
      lastEndAt: _.gt(weekStart),
    }, {
      _id: true,
      status: true,
      userId: true,
      projectId: true,
      segments: true,
      firstStartAt: true,
      lastEndAt: true,
      projectAbbrDisplayCache: true,
    }),
    fetchAll('bookings', {
      status: _.in(activeStatuses),
      startAt: _.lt(weekEnd),
      endAt: _.gt(weekStart),
    }, {
      _id: true, status: true, userId: true, projectId: true, startAt: true, endAt: true, projectAbbr: true,
    }),
    fetchAll('maintenance_slots', {
      status: 'active',
      startAt: _.lt(weekEnd),
      endAt: _.gt(weekStart),
    }, { _id: true, startAt: true, endAt: true, status: true }),
    db.collection('settings').doc('global').get(),
  ])
  const settings = settingsRes.data || {}
  const bookingUserMap = await fetchUserMap([
    ...bookingsRes.map((item) => item.userId),
    ...legacyBookingsRes.map((item) => item.userId),
  ])

  const slots = []
  bookingsRes.forEach((item) => {
    const segments = Array.isArray(item.segments) && item.segments.length > 0
      ? item.segments.filter((segment) => segment.state !== 'cancelled')
      : [{ startAt: item.firstStartAt, endAt: item.lastEndAt }]
    const state = item.status === 'pending_review' ? 'pending' : 'occupied'
    const bookingUser = bookingUserMap[item.userId]
    const userName = canExposeUserName(currentUser, item.projectId) ? (bookingUser && bookingUser.name ? bookingUser.name : '') : ''
    segments.forEach((segment, index) => {
      const slot = {
        startAt: segment.startAt,
        endAt: segment.endAt,
        state,
        status: item.status,
        projectAbbr: item.projectAbbrDisplayCache || '',
        userName,
        publicRenderId: `slot-${slots.length}-${index}`,
      }
      if (isAdmin) slot.bookingId = item._id
      slots.push(slot)
    })
  })

  legacyBookingsRes.forEach((item) => {
    const bookingUser = bookingUserMap[item.userId]
    const slot = {
      startAt: item.startAt,
      endAt: item.endAt,
      state: item.status === 'pending_review' ? 'pending' : 'occupied',
      status: item.status,
      projectAbbr: item.projectAbbr || '',
      userName: canExposeUserName(currentUser, item.projectId) ? (bookingUser && bookingUser.name ? bookingUser.name : '') : '',
      publicRenderId: `legacy-slot-${slots.length}`,
    }
    if (isAdmin) slot.bookingId = item._id
    slots.push(slot)
  })

  maintenanceRes.forEach((item) => {
    const slot = {
      startAt: item.startAt,
      endAt: item.endAt,
      state: 'maintenance',
      projectAbbr: '',
      publicRenderId: `maintenance-slot-${slots.length}`,
    }
    if (isAdmin) slot.maintenanceId = item._id
    slots.push(slot)
  })

  return ok({
    weekStart: weekStartDate,
    serverNow: new Date(),
    rulesVersion: settings.rulesVersion || 1,
    serviceMode: settings.serviceMode || 'normal',
    maxAdvanceDays: settings.maxAdvanceDays || 7,
    slots,
  })
}
