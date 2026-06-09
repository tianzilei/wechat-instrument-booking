const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) {
  return { success: true, data, error: null }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  let statusFilter = {}
  if (event.status === 'upcoming') statusFilter = { status: _.in(['confirmed', 'pending_review']) }
  if (event.status === 'pending') statusFilter = { status: _.in(['pending_review', 'cancel_pending']) }
  if (event.status === 'cancelled') statusFilter = { status: 'cancelled' }
  const res = await db.collection('bookings').where({
    openid: OPENID,
    ...statusFilter,
  }).orderBy('startAt', 'desc').limit(100).get()
  return ok({ items: res.data })
}
