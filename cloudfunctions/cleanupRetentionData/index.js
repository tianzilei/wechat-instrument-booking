const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 500

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function ensureInternalOrAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return true
  const user = (await db.collection('users').where({ openid: OPENID }).field({ role: true }).limit(1).get()).data[0]
  return !!(user && user.role === 'admin')
}

async function anonymizeOldBookings(cutoffDate) {
  let total = 0
  let skip = 0
  while (true) {
    const batch = await db.collection('bookings').where({
      createdAt: _.lt(cutoffDate),
    }).orderBy('createdAt', 'asc').skip(skip).limit(PAGE_SIZE).get()
    if (batch.data.length === 0) break

    await Promise.all(batch.data.map((booking) => db.collection('bookings').doc(booking._id).update({
      data: {
        userId: '',
        projectId: '',
        projectAbbrDisplayCache: '',
        remark: '',
        reviewReason: '',
        cancellationNote: '',
        updatedAt: db.serverDate(),
      },
    })))
    total += batch.data.length
    skip += batch.data.length
  }
  return total
}

async function scrubOldReviewLogs(cutoffDate) {
  let total = 0
  let skip = 0
  while (true) {
    const batch = await db.collection('review_logs').where({
      createdAt: _.lt(cutoffDate),
    }).orderBy('createdAt', 'asc').skip(skip).limit(PAGE_SIZE).get()
    if (batch.data.length === 0) break

    await Promise.all(batch.data.map((reviewLog) => db.collection('review_logs').doc(reviewLog._id).update({
      data: {
        reason: '',
        updatedAt: db.serverDate(),
      },
    })))
    total += batch.data.length
    skip += batch.data.length
  }
  return total
}

exports.main = async () => {
  if (!(await ensureInternalOrAdmin())) {
    return fail('PERMISSION_DENIED', '无权限操作')
  }
  const now = new Date()
  const results = {}

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600000)
  const errorLogsDeleted = await db.collection('error_logs').where({
    createdAt: _.lt(thirtyDaysAgo),
  }).remove()
  results.errorLogsDeleted = errorLogsDeleted.removed || 0

  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600000)
  const privacyDeleted = await db.collection('privacy_requests').where({
    status: _.in(['completed', 'rejected']),
    updatedAt: _.lt(ninetyDaysAgo),
  }).remove()
  results.privacyRequestsAnonymized = privacyDeleted.removed || 0

  const yearAgo = new Date(now.getTime() - 365 * 24 * 3600000)
  results.bookingsAnonymized = await anonymizeOldBookings(yearAgo)
  results.reviewLogsCleaned = await scrubOldReviewLogs(yearAgo)

  return { success: true, data: results }
}
