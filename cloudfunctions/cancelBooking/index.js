const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!event.bookingId) return fail('INVALID_PARAMS', '参数错误')
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  const ref = db.collection('bookings').doc(event.bookingId)
  const booking = (await ref.get()).data
  if (!booking) return fail('NOT_FOUND', '预约不存在')
  if (booking.userId !== user._id) return fail('PERMISSION_DENIED', '只能取消自己的预约')
  if (!['confirmed', 'pending_review'].includes(booking.status)) return fail('STATE_CHANGED', '当前状态不可取消')

  if (event.reason) {
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '取消原因包含违规信息，请修改后重试')
      }
    } catch (err) {
      console.error('msgSecCheck error:', err.errCode || err.message)
      return fail('CONTENT_UNSAFE', '内容安全检查失败，请稍后重试')
    }
  }

  const startAt = new Date(booking.startAt)
  const needReview = startAt.getTime() - Date.now() <= 12 * 3600000
  const status = needReview ? 'cancel_pending' : 'cancelled'
  const now = db.serverDate()
  await ref.update({
    data: {
      status,
      cancelReason: event.reason || '',
      cancelRequestedAt: now,
      updatedAt: now,
    },
  })

  return ok({ bookingId: event.bookingId, status, needReview })
}
