const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')

  if (!event.requestId || !['processing', 'complete', 'reject'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')
  const ref = db.collection('privacy_requests').doc(event.requestId)
  const req = (await ref.get()).data
  if (!req || req.status !== 'pending') return fail('STATE_CHANGED', '请求状态已变化')

  if (event.note) {
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.note })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '处理说明包含违规信息')
      }
    } catch (err) {
      return fail('CONTENT_CHECK_FAILED', '处理说明内容安全校验失败，请稍后重试')
    }
  }

  const statusMap = { processing: 'processing', complete: 'completed', reject: 'rejected' }
  await ref.update({
    data: {
      status: statusMap[event.action],
      processNote: event.note || '',
      processedBy: admin._id,
      updatedAt: db.serverDate(),
    },
  })
  return ok({ requestId: event.requestId, status: statusMap[event.action] })
}
