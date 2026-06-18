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

async function getAdmin(openid) {
  if (!openid) return null
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin' ? user : null
}

async function fetchAllConfirmedBookingsSince(startAt) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection('bookings').where({
      status: 'confirmed',
      firstStartAt: _.gte(startAt),
    }).skip(skip).limit(1000).get()
    items.push(...batch.data)
    if (batch.data.length < 1000) hasMore = false
    else skip += batch.data.length
  }
  return items
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!(await getAdmin(OPENID))) return fail('PERMISSION_DENIED', '无权限操作')

  const registrationPending = await db.collection('registration_applications').where({ status: 'pending' }).count()
  const projectPending = await db.collection('project_applications').where({ status: 'pending' }).count()
  const bookingPending = await db.collection('bookings').where({ status: 'pending_review' }).count()
  const cancelPending = await db.collection('bookings').where({ status: _.in(['cancel_pending', 'rule_review_pending']) }).count()
  const privacyPending = await db.collection('privacy_requests').where({ status: 'pending' }).count()
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthBookings = await fetchAllConfirmedBookingsSince(monthStart)
  const monthHours = monthBookings.reduce((sum, item) => sum + (item.durationHours || 0), 0)

  return ok({
    registrationPending: registrationPending.total,
    projectPending: projectPending.total,
    reviewPending: registrationPending.total + projectPending.total,
    bookingPending: bookingPending.total,
    cancelPending: cancelPending.total,
    privacyPending: privacyPending.total,
    monthHours,
  })
}
