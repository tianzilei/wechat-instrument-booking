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

  if (!event.bookingId || !['approve', 'reject'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')
  const booking = (await db.collection('bookings').doc(event.bookingId).get()).data
  if (!booking || booking.status !== 'pending_review') return fail('STATE_CHANGED', '预约状态已变化')

  if (event.reason) {
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '拒绝原因包含违规信息')
      }
    } catch (err) {
      return fail('CONTENT_CHECK_FAILED', '拒绝原因内容安全校验失败，请稍后重试')
    }
  }

  const now = db.serverDate()
  if (event.action === 'reject') {
    const segments = (booking.segments || []).map((s) => ({
      ...s,
      state: 'cancelled',
      cancelledAt: now,
      cancelReasonCode: 'review_rejected',
    }))
    await db.collection('bookings').doc(event.bookingId).update({
      data: { status: 'rejected', segments, reviewReason: event.reason || '', reviewedBy: admin._id, reviewedAt: now, updatedAt: now },
    })
  } else {
    await db.collection('bookings').doc(event.bookingId).update({
      data: { status: 'confirmed', previousStatus: '', reviewedBy: admin._id, reviewedAt: now, updatedAt: now },
    })
  }

  await db.collection('review_logs').add({
    data: {
      targetType: 'booking', targetId: event.bookingId,
      action: event.action, reason: event.reason || '',
      reviewerId: admin._id, createdAt: now,
    },
  })

  return ok({ bookingId: event.bookingId, status: event.action === 'approve' ? 'confirmed' : 'rejected' })
}
