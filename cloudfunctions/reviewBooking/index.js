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
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')
  if (!event.bookingId || !['approve', 'reject'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')

  if (event.action === 'reject' && event.reason) {
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '拒绝原因包含违规信息，请修改后重试')
      }
    } catch (err) {
      console.error('msgSecCheck error:', err.errCode || err.message)
    }
  }

  const bookingRes = await db.collection('bookings').doc(event.bookingId).get()
  const booking = bookingRes.data
  if (!booking || booking.status !== 'pending_review') return fail('STATE_CHANGED', '预约状态已变化')

  const now = db.serverDate()
  const status = event.action === 'approve' ? 'confirmed' : 'rejected'
  await db.collection('bookings').doc(event.bookingId).update({
    data: {
      status,
      reviewedBy: admin._id,
      reviewedAt: now,
      reviewReason: event.reason || '',
      updatedAt: now,
    },
  })
  await db.collection('review_logs').add({
    data: {
      targetType: 'booking',
      targetId: event.bookingId,
      action: event.action,
      reason: event.reason || '',
      reviewerId: admin._id,
      createdAt: now,
    },
  })
  return ok({ bookingId: event.bookingId, status })
}
