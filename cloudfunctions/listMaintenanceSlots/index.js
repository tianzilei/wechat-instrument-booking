const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')
  const res = await db.collection('maintenance_slots')
    .where({ status: 'active' })
    .field({
      _id: true,
      startAt: true,
      endAt: true,
      reason: true,
      status: true,
      createdAt: true,
      cancelledBookingCount: true,
    })
    .orderBy('startAt', 'desc')
    .limit(100)
    .get()
  return ok({ items: res.data })
}
