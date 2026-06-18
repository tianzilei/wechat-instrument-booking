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
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')
  if (!event.requestId) return fail('INVALID_PARAMS', '参数错误')

  const request = (await db.collection('privacy_requests').doc(event.requestId).get()).data
  if (!request) return fail('NOT_FOUND', '隐私请求不存在')

  let userName = ''
  if (request.userId) {
    try {
      const user = (await db.collection('users').doc(request.userId).field({ name: true }).get()).data
      userName = user && user.name ? user.name : ''
    } catch (err) {}
  }

  return ok({
    requestId: request._id,
    userId: request.userId,
    userName,
    type: request.type || '',
    note: request.note || '',
    processNote: request.processNote || '',
    status: request.status || '',
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  })
}
