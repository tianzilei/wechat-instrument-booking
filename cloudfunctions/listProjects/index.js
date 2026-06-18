const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const PAGE_SIZE = 100

function ok(data) { return { success: true, data, error: null } }

async function fetchProjects(status, limit) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore && items.length < limit) {
    const batch = await db.collection('projects').where({ status })
      .field({ _id: true, name: true, abbr: true, status: true, createdAt: true, updatedAt: true })
      .orderBy('name', 'asc')
      .skip(skip)
      .limit(Math.min(PAGE_SIZE, limit - items.length))
      .get()
    items.push(...batch.data)
    if (batch.data.length < Math.min(PAGE_SIZE, limit - items.length)) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true, role: true }).limit(1).get()
  const user = userRes.data[0]
  const isAdmin = user && user.role === 'admin'

  let status = ['active', 'inactive'].includes(event.status) ? event.status : 'active'
  if (!isAdmin && status !== 'active') status = 'active'

  const limit = Math.min(Math.max(parseInt(event.limit, 10) || 200, 1), 500)
  const items = await fetchProjects(status, limit)
  return ok({ items })
}
