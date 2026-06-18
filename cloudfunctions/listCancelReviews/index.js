const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 100
const IN_QUERY_SIZE = 100

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function isAdmin(openid) {
  if (!openid) return false
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin'
}

function chunk(items, size) {
  const batches = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

async function fetchAllCancelReviews() {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection('bookings')
      .where({ status: 'cancel_pending' })
      .field({
        _id: true,
        userId: true,
        projectAbbrDisplayCache: true,
        firstStartAt: true,
        lastEndAt: true,
        segments: true,
        durationHours: true,
        status: true,
        cancellationNote: true,
        createdAt: true,
        updatedAt: true,
      })
      .orderBy('updatedAt', 'asc')
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

async function fetchUserNames(userIds) {
  const map = {}
  for (const ids of chunk(userIds, IN_QUERY_SIZE)) {
    if (ids.length === 0) continue
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

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!(await isAdmin(OPENID))) return fail('PERMISSION_DENIED', '无权限操作')
  const reviews = await fetchAllCancelReviews()
  const userIds = [...new Set(reviews.map((item) => item.userId).filter(Boolean))]
  const userNames = await fetchUserNames(userIds)
  const items = reviews.map((item) => ({
    ...item,
    startAt: item.firstStartAt,
    endAt: item.lastEndAt,
    projectAbbr: item.projectAbbrDisplayCache || '',
    userName: userNames[item.userId] || '',
    cancelReason: item.cancellationNote || '',
  }))

  return ok({ items })
}
