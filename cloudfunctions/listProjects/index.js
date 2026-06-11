const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true, role: true }).limit(1).get()
  const user = userRes.data[0]
  const isAdmin = user && user.role === 'admin'

  let status = ['active', 'inactive'].includes(event.status) ? event.status : 'active'
  if (!isAdmin && status !== 'active') status = 'active'

  const limit = Math.min(Math.max(parseInt(event.limit, 10) || 50, 1), 100)
  const query = db.collection('projects').where({ status })
    .field({ _id: true, name: true, abbr: true, status: true, createdAt: true, updatedAt: true })
    .orderBy('name', 'asc')
    .limit(limit)
  const res = await query.get()
  return ok({ items: res.data })
}
