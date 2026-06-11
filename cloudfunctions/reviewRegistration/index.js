const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function getCurrentAdmin(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getCurrentAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')
  if (!event.userId || !['approve', 'reject'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')
  if (event.action === 'reject' && !event.reason) return fail('INVALID_PARAMS', '请填写拒绝原因')

  // Content safety check on reject reason
  if (event.action === 'reject' && event.reason) {
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '拒绝原因包含违规信息，请修改后重试')
      }
    } catch (err) {
      console.warn('msgSecCheck unavailable, proceeding:', err.errCode || err.message)
    }
  }

  const status = event.action === 'approve' ? 'approved' : 'rejected'
  const now = db.serverDate()
  await db.collection('users').doc(event.userId).update({
    data: {
      registrationStatus: status,
      rejectReason: event.action === 'reject' ? event.reason : '',
      reviewedBy: admin._id,
      reviewedAt: now,
      updatedAt: now,
    },
  })
  await db.collection('review_logs').add({
    data: {
      targetType: 'registration',
      targetId: event.userId,
      action: event.action,
      reason: event.reason || '',
      reviewerId: admin._id,
      createdAt: now,
    },
  })
  return ok({ userId: event.userId, registrationStatus: status })
}
