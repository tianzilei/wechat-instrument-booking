const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }

exports.main = async (event) => {
  const status = event.status || 'active'
  const query = db.collection('projects').where({ status })
    .field({ _id: true, name: true, abbr: true, status: true, createdAt: true, updatedAt: true })
    .orderBy('name', 'asc')
    .limit(event.limit || 50)
  const res = await query.get()
  return ok({ items: res.data })
}
