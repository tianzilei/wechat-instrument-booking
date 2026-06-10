const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

exports.main = async () => {
  const res = await db.collection('maintenance_slots')
    .where({ status: 'active' })
    .field({
      _id: true,
      startAt: true,
      endAt: true,
      reason: true,
      status: true,
      createdAt: true,
    })
    .orderBy('startAt', 'desc')
    .limit(100)
    .get()
  return ok({ items: res.data })
}
