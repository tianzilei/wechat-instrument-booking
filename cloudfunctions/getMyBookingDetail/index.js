const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  const booking = (await db.collection('bookings').doc(event.bookingId).get()).data
  if (!booking || booking.userId !== user._id) return fail('PERMISSION_DENIED', '无权查看')

  const reviewLogs = await db.collection('review_logs').where({ targetType: 'booking', targetId: event.bookingId }).orderBy('createdAt', 'asc').get()

  return ok({
    bookingId: booking._id,
    userId: booking.userId,
    projectAbbr: booking.projectAbbr || '',
    startAt: booking.startAt,
    endAt: booking.endAt,
    occupiedSegments: booking.occupiedSegments || [],
    durationHours: booking.durationHours || 0,
    remark: booking.remark || '',
    status: booking.status,
    bookingType: booking.bookingType,
    specialReasons: booking.specialReasons || [],
    reviewReason: booking.reviewReason || '',
    cancelReason: booking.cancelReason || '',
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    reviewLogs: reviewLogs.data.map((log) => ({
      action: log.action,
      reason: log.reason || '',
      createdAt: log.createdAt,
    })),
  })
}
