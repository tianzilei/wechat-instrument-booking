const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

exports.main = async () => {
  const res = await db.collection('restricted_slots').where({ status: 'active' }).orderBy('startAt', 'desc').limit(100).get()
  return ok({ items: res.data })
}
