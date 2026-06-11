const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async () => {
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
  const oldBookings = await db.collection('bookings').where({
    createdAt: _.lt(yearAgo),
  }).limit(500).get()
  let anonymizedBookings = 0
  for (const b of oldBookings.data) {
    await db.collection('bookings').doc(b._id).update({
      data: {
        userId: '',
        projectId: '',
        projectAbbrDisplayCache: '',
        remark: '',
        reviewReason: '',
        cancellationNote: '',
        updatedAt: db.serverDate(),
      },
    })
    anonymizedBookings += 1
  }
  results.bookingsAnonymized = anonymizedBookings

  const oldReviews = await db.collection('review_logs').where({
    createdAt: _.lt(yearAgo),
  }).limit(500).get()
  let deletedReviews = 0
  for (const r of oldReviews.data) {
    await db.collection('review_logs').doc(r._id).update({
      data: {
        reason: '',
        updatedAt: db.serverDate(),
      },
    })
    deletedReviews += 1
  }
  results.reviewLogsCleaned = deletedReviews

  return { success: true, data: results }
}
