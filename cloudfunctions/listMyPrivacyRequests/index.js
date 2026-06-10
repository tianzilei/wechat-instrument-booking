const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  const res = await db.collection('privacy_requests')
    .where({ userId: user._id })
    .field({ _id: true, type: true, status: true, note: true, processNote: true, createdAt: true, updatedAt: true })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
  return ok({ items: res.data })
}
