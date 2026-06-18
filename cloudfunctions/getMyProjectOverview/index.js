const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 100
const IN_QUERY_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1000
const RECENT_DAYS = 7
const ALLOWED_BOOKING_STATUSES = ['pending_review', 'confirmed', 'completed', 'cancel_pending', 'rule_review_pending']

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getCurrentUser(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).field({
    _id: true,
    role: true,
    name: true,
    registrationStatus: true,
    accountStatus: true,
    projectId: true,
    projectName: true,
    projectAbbr: true,
  }).limit(1).get()
  return res.data[0] || null
}

async function fetchAll(collectionName, where, options) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection(collectionName)
      .where(where)
      .field(options.field)
      .orderBy(options.orderBy, options.order)
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

function chunk(items, size) {
  const batches = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

async function fetchUserNameMap(userIds) {
  const map = {}
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))]
  for (const ids of chunk(uniqueIds, IN_QUERY_SIZE)) {
    const batch = await db.collection('users').where({
      _id: _.in(ids),
    }).field({
      _id: true,
      name: true,
    }).get()
    batch.data.forEach((item) => {
      map[item._id] = item.name || ''
    })
  }
  return map
}

function computeDurationHours(item) {
  if (typeof item.durationHours === 'number') return item.durationHours
  const startAt = new Date(item.firstStartAt || item.startAt).getTime()
  const endAt = new Date(item.lastEndAt || item.endAt).getTime()
  return Math.max(0, (endAt - startAt) / (60 * 60 * 1000))
}

function splitBookings(bookings, now) {
  const futureItems = []
  const recentItems = []
  bookings.forEach((item) => {
    const startAt = new Date(item.startAt).getTime()
    if (startAt >= now) {
      futureItems.push(item)
    } else {
      recentItems.push(item)
    }
  })
  futureItems.sort((left, right) => new Date(left.startAt) - new Date(right.startAt))
  recentItems.sort((left, right) => new Date(right.startAt) - new Date(left.startAt))
  return { futureItems, recentItems }
}

function buildNotice(user, project) {
  if (user.accountStatus === 'project_reassignment_required') {
    return '当前课题已停用或需重新分配，以下信息仅供临时查看，请尽快重新选择课题。'
  }
  if (!project || project.status === 'missing') {
    return '当前课题信息暂不可用，请联系管理员核对课题归属。'
  }
  if (project.status === 'inactive') {
    return '当前课题已停用，以下信息仅供查看，新的预约与候补需要先完成课题调整。'
  }
  return ''
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const user = await getCurrentUser(OPENID)
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  if (user.role === 'admin') return fail('PERMISSION_DENIED', '管理员账号不使用“我的课题”页面')
  if (user.registrationStatus !== 'approved') return fail('REGISTRATION_REQUIRED', '注册审核通过并关联课题后才能查看')
  if (!user.projectId) return fail('PROJECT_REQUIRED', '当前账号尚未绑定课题')
  if (user.accountStatus && !['active', 'project_reassignment_required'].includes(user.accountStatus)) {
    return fail('ACCOUNT_UNAVAILABLE', '当前账号状态不可查看课题信息')
  }

  const threshold = new Date(Date.now() - RECENT_DAYS * DAY_MS)
  const [projectRes, members, v2Bookings, legacyBookings] = await Promise.all([
    db.collection('projects').doc(user.projectId).get().catch(() => ({ data: null })),
    fetchAll('users', {
      projectId: user.projectId,
      registrationStatus: 'approved',
    }, {
      field: {
        _id: true,
        role: true,
        name: true,
        accountStatus: true,
        updatedAt: true,
      },
      orderBy: 'name',
      order: 'asc',
    }),
    fetchAll('bookings', {
      projectId: user.projectId,
      status: _.in(ALLOWED_BOOKING_STATUSES),
      firstStartAt: _.gte(threshold),
    }, {
      field: {
        _id: true,
        userId: true,
        status: true,
        firstStartAt: true,
        lastEndAt: true,
        durationHours: true,
        projectAbbrDisplayCache: true,
      },
      orderBy: 'firstStartAt',
      order: 'asc',
    }),
    fetchAll('bookings', {
      projectId: user.projectId,
      status: _.in(ALLOWED_BOOKING_STATUSES),
      firstStartAt: _.exists(false),
      startAt: _.gte(threshold),
    }, {
      field: {
        _id: true,
        userId: true,
        status: true,
        startAt: true,
        endAt: true,
        durationHours: true,
        projectAbbr: true,
      },
      orderBy: 'startAt',
      order: 'asc',
    }),
  ])

  const projectDoc = projectRes && projectRes.data ? projectRes.data : null
  const project = projectDoc
    ? {
      _id: projectDoc._id,
      name: projectDoc.name || user.projectName || '',
      abbr: projectDoc.abbr || user.projectAbbr || '',
      status: projectDoc.status || 'active',
    }
    : {
      _id: user.projectId,
      name: user.projectName || '',
      abbr: user.projectAbbr || '',
      status: 'missing',
    }

  const memberMap = members.reduce((map, item) => {
    map[item._id] = item
    return map
  }, {})
  const bookingUserNameMap = await fetchUserNameMap([
    ...v2Bookings.map((item) => item.userId),
    ...legacyBookings.map((item) => item.userId),
  ])

  const bookingItems = [...v2Bookings, ...legacyBookings].map((item) => ({
    _id: item._id,
    userId: item.userId || '',
    userName: bookingUserNameMap[item.userId] || (memberMap[item.userId] ? (memberMap[item.userId].name || '') : ''),
    status: item.status,
    startAt: item.firstStartAt || item.startAt,
    endAt: item.lastEndAt || item.endAt,
    durationHours: computeDurationHours(item),
    projectAbbr: item.projectAbbrDisplayCache || item.projectAbbr || project.abbr || '',
  }))

  const split = splitBookings(bookingItems, Date.now())
  return ok({
    scopeDays: RECENT_DAYS,
    notice: buildNotice(user, project),
    currentUser: {
      accountStatus: user.accountStatus || 'active',
      projectId: user.projectId,
      projectName: user.projectName || '',
      projectAbbr: user.projectAbbr || '',
    },
    project,
    summary: {
      memberCount: members.length,
      activeMemberCount: members.filter((item) => (item.accountStatus || 'active') === 'active').length,
      futureBookingCount: split.futureItems.length,
      recentBookingCount: split.recentItems.length,
    },
    members: members.map((item) => ({
      _id: item._id,
      name: item.name || '',
      role: item.role || 'user',
      accountStatus: item.accountStatus || 'active',
    })),
    futureBookings: split.futureItems,
    recentBookings: split.recentItems,
  })
}
