const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('NOT_FOUND', '用户不存在')
  if (user.role === 'admin') return fail('PERMISSION_DENIED', '管理员不能注销账号')

  const now = new Date()
  const nowServer = db.serverDate()
  const existingTaskRes = await db.collection('deletion_tasks').where({ userId: user._id }).limit(1).get()
  const existingTask = existingTaskRes.data[0] || null

  if (existingTask && existingTask.status === 'completed') {
    return fail('STATE_CHANGED', '账号注销已完成，请重新登录')
  }

  await db.collection('users').doc(user._id).update({
    data: {
      accountStatus: 'deleting',
      updatedAt: nowServer,
    },
  })

  if (existingTask) {
    const leaseUntil = existingTask.leaseUntil ? new Date(existingTask.leaseUntil) : null
    if (existingTask.status === 'running' && leaseUntil && leaseUntil > now) {
      return ok({ queued: true, taskId: existingTask._id, alreadyQueued: true })
    }
    await db.collection('deletion_tasks').doc(existingTask._id).update({
      data: {
        status: 'created',
        nextRetryAt: now,
        leaseUntil: null,
        lastErrorCode: '',
        updatedAt: nowServer,
      },
    })
    return ok({ queued: true, taskId: existingTask._id, alreadyQueued: true })
  }

  const taskRes = await db.collection('deletion_tasks').add({
    data: {
      userId: user._id,
      status: 'created',
      nextRetryAt: now,
      leaseUntil: null,
      attempt: 0,
      lastErrorCode: '',
      cancelledBookings: 0,
      cancelledWaitlists: 0,
      anonymizedBookings: 0,
      cleanedUpNotifications: false,
      cleanedUpPrivacyRequests: false,
      createdAt: nowServer,
      updatedAt: nowServer,
    },
  })

  return ok({ queued: true, taskId: taskRes._id, alreadyQueued: false })
}
