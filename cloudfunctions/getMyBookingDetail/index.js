const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  if (!event.bookingId) return fail('INVALID_PARAMS', '参数错误')
  const booking = (await db.collection('bookings').doc(event.bookingId).get()).data
  if (!booking || booking.userId !== user._id) return fail('PERMISSION_DENIED', '无权查看')

  const reviewLogs = await db.collection('review_logs').where({
    targetType: _.in(['booking', 'cancel']),
    targetId: event.bookingId,
  }).orderBy('createdAt', 'asc').get()

  return ok({
    bookingId: booking._id,
    userId: booking.userId,
    projectAbbr: booking.projectAbbrDisplayCache || booking.projectAbbr || '',
    startAt: booking.firstStartAt || booking.startAt,
    endAt: booking.lastEndAt || booking.endAt,
    segments: booking.segments || booking.occupiedSegments || [],
    durationHours: booking.durationHours || 0,
    remark: booking.remark || '',
    status: booking.status,
    bookingType: booking.bookingType,
    specialReasons: booking.specialReasons || [],
    reviewReason: booking.reviewReason || '',
    cancellationNote: booking.cancellationNote || booking.cancelReason || '',
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    reviewLogs: reviewLogs.data.map((log) => ({
      targetType: log.targetType || 'booking',
      action: log.action,
      reason: log.reason || '',
      createdAt: log.createdAt,
    })),
  })
}
