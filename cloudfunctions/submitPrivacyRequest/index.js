const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

const VALID_TYPES = ['query', 'correct', 'delete', 'withdraw_consent', 'deactivate', 'complaint']

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  if (!event.type || !VALID_TYPES.includes(event.type)) return fail('INVALID_PARAMS', '无效的请求类型')

  if (event.note) {
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.note })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '补充说明包含违规信息')
      }
    } catch (err) {
      console.error('msgSecCheck error:', err.errCode || err.message)
    }
  }

  const now = db.serverDate()
  const res = await db.collection('privacy_requests').add({
    data: {
      userId: user._id,
      type: event.type,
      note: event.note || '',
      status: 'pending',
      processNote: '',
      processedBy: '',
      createdAt: now,
      updatedAt: now,
    },
  })
  return ok({ requestId: res._id, status: 'pending' })
}
