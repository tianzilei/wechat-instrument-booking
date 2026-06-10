const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getAdmin(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')

  const booking = (await db.collection('bookings').doc(event.bookingId).get()).data
  if (!booking) return fail('NOT_FOUND', '预约不存在')

  let userName = ''
  if (booking.userId) {
    const userRes = await db.collection('users').doc(booking.userId).field({ name: true }).get()
    if (userRes.data) userName = userRes.data.name || ''
  }

  const reviewLogs = await db.collection('review_logs').where({
    targetType: _.in(['booking', 'cancel']),
    targetId: event.bookingId,
  }).orderBy('createdAt', 'asc').get()

  return ok({
    bookingId: booking._id,
    userId: booking.userId,
    userName,
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
