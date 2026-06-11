const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

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

  if (!event.userId || !event.reason) return fail('INVALID_PARAMS', '缺少用户ID或暂停原因')
  if (event.reason.length > 500) return fail('INVALID_PARAMS', '暂停原因不超过 500 字')

  try {
    const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
    if (checkRes.result && checkRes.result.suggest === 'risky') {
      return fail('CONTENT_UNSAFE', '暂停原因包含违规信息')
    }
  } catch (err) {
    console.error('msgSecCheck error:', err.errCode || err.message)
      return fail('CONTENT_UNSAFE', '内容安全检查失败，请稍后重试')
  }

  const userRef = db.collection('users').doc(event.userId)
  const user = (await userRef.get()).data
  if (!user) return fail('NOT_FOUND', '用户不存在')
  if (user.accountStatus === 'suspended') return fail('STATE_CHANGED', '账号已被暂停')

  const now = db.serverDate()

  const bookings = await db.collection('bookings').where({
    userId: event.userId,
    status: _.in(['pending_review', 'confirmed', 'cancel_pending']),
  }).get()
  await Promise.all(bookings.data.map((b) => db.collection('bookings').doc(b._id).update({
    data: { status: 'cancelled', cancellationNote: 'account_suspended', updatedAt: now },
  })))

  const waitlists = await db.collection('waitlists').where({
    userId: event.userId,
    status: _.nin(['cancelled', 'expired']),
  }).get()
  await Promise.all(waitlists.data.map((w) => db.collection('waitlists').doc(w._id).update({
    data: { status: 'cancelled', updatedAt: now },
  })))

  await userRef.update({
    data: {
      accountStatus: 'suspended',
      suspendedReason: event.reason,
      suspendedAt: now,
      updatedAt: now,
    },
  })

  await db.collection('important_events').add({
    data: {
      userId: event.userId,
      type: 'account_suspended',
      summary: `账号已于 ${new Date().toISOString().slice(0, 10)} 暂停`,
      readAt: null,
      createdAt: now,
    },
  })

  await db.collection('review_logs').add({
    data: { targetType: 'user', targetId: event.userId, action: 'suspend', reason: event.reason, reviewerId: admin._id, createdAt: now },
  })

  return ok({ userId: event.userId, cancelledBookings: bookings.data.length, cancelledWaitlists: waitlists.data.length })
}
