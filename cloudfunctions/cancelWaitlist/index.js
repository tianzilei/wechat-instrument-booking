const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  if (!event.waitlistId) return fail('INVALID_PARAMS', '参数错误')
  const ref = db.collection('waitlists').doc(event.waitlistId)
  const waitlist = (await ref.get()).data
  if (!waitlist || waitlist.userId !== user._id) return fail('PERMISSION_DENIED', '无权限操作')
  await ref.update({ data: { status: 'cancelled', updatedAt: db.serverDate() } })
  return ok({ waitlistId: event.waitlistId, status: 'cancelled' })
}
