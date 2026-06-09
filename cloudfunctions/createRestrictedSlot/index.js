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
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')
  const startAt = new Date(event.startAt)
  const endAt = new Date(event.endAt)
  if (!(startAt < endAt)) return fail('INVALID_PARAMS', '时间参数错误')
  const res = await db.collection('restricted_slots').add({
    data: {
      startAt,
      endAt,
      reason: event.reason || '',
      createdBy: admin._id,
      status: 'active',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  })
  return ok({ restrictedSlotId: res._id })
}
