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

  if (!event.userId) return fail('INVALID_PARAMS', '缺少用户ID')
  const userRef = db.collection('users').doc(event.userId)
  const user = (await userRef.get()).data
  if (!user) return fail('NOT_FOUND', '用户不存在')
  if (user.role === 'admin') return fail('PERMISSION_DENIED', '管理员账号无需恢复')
  if (user.accountStatus !== 'suspended') return fail('STATE_CHANGED', '账号未被暂停')

  const nowServer = db.serverDate()
  await userRef.update({
    data: {
      accountStatus: 'active',
      suspendedReason: '',
      suspendedAt: null,
      updatedAt: nowServer,
    },
  })

  await db.collection('important_events').where({
    userId: event.userId,
    type: 'account_suspended',
    readAt: null,
  }).update({
    data: {
      readAt: nowServer,
    },
  })

  await db.collection('important_events').add({
    data: {
      userId: event.userId,
      type: 'account_restored',
      summary: '账号已恢复，可继续正常使用预约服务',
      readAt: null,
      createdAt: nowServer,
    },
  })

  await db.collection('review_logs').add({
    data: { targetType: 'user', targetId: event.userId, action: 'restore', reason: '管理员恢复账号', reviewerId: admin._id, createdAt: nowServer },
  })

  return ok({ userId: event.userId, restored: true })
}
