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
  const ref = db.collection('bookings').doc(event.bookingId)
  const booking = (await ref.get()).data
  if (!booking) return fail('NOT_FOUND', '预约不存在')
  if (booking.openid !== OPENID) return fail('PERMISSION_DENIED', '只能取消自己的预约')
  if (!['confirmed', 'pending_review'].includes(booking.status)) return fail('STATE_CHANGED', '当前状态不可取消')

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
