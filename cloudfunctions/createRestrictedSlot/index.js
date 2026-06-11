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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')
  const startAt = new Date(event.startAt)
  const endAt = new Date(event.endAt)
  if (!(startAt < endAt)) return fail('INVALID_PARAMS', '时间参数错误')

  if (event.reason) {
    if (event.reason.length > 500) return fail('INVALID_PARAMS', '受限原因不超过 500 字')
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '受限说明包含违规信息，请修改后重试')
      }
    } catch (err) {
      console.error('msgSecCheck error:', err.errCode || err.message)
      return fail('CONTENT_UNSAFE', '内容安全检查失败，请稍后重试')
    }
  }
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

  await db.collection('review_logs').add({
    data: { targetType: 'restricted', targetId: res._id, action: 'create', reason: event.reason || '', reviewerId: admin._id, createdAt: db.serverDate() },
  })

  return ok({ restrictedSlotId: res._id })
}
