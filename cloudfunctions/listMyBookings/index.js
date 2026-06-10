const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  let statusFilter = {}
  if (event.status === 'upcoming') statusFilter = { status: _.in(['confirmed', 'pending_review']) }
  if (event.status === 'pending') statusFilter = { status: _.in(['pending_review', 'cancel_pending']) }
  if (event.status === 'cancelled') statusFilter = { status: 'cancelled' }
  const res = await db.collection('bookings').where({
    userId: user._id,
    ...statusFilter,
  })
  .field({
    _id: true,
    userId: true,
    projectAbbr: true,
    startAt: true,
    endAt: true,
    durationHours: true,
    remark: true,
    status: true,
    bookingType: true,
    specialReasons: true,
    reviewReason: true,
    cancelReason: true,
    createdAt: true,
    updatedAt: true,
  })
  .orderBy('startAt', 'desc')
  .limit(100)
  .get()
  return ok({ items: res.data })
}
