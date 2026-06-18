const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const IN_QUERY_SIZE = 100

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

function chunk(items, size) {
  const batches = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
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
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')

  const res = await db.collection('privacy_requests')
    .where({ status: 'pending' })
    .field({ _id: true, userId: true, type: true, note: true, status: true, createdAt: true })
    .orderBy('createdAt', 'asc')
    .limit(50)
    .get()
  const items = res.data || []
  const userIds = [...new Set(items.map((item) => item.userId).filter(Boolean))]
  const userNames = await fetchUserNames(userIds)
  return ok({
    items: items.map((item) => ({
      ...item,
      userName: userNames[item.userId] || '',
    })),
  })
}
