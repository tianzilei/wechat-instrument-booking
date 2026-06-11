const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async () => {
  const now = new Date()
  const pending = await db.collection('bookings').where({
    status: 'cancel_pending',
    firstStartAt: db.command.lte(now),
  }).limit(50).get()

  const results = { processed: 0, autoRejected: 0 }
  for (const booking of pending.data) {
    results.processed += 1
    const previousStatus = booking.previousStatus || 'confirmed'
    if (!['confirmed', 'pending_review'].includes(previousStatus)) {
      results.processed -= 1
      continue
    }
    await db.collection('bookings').doc(booking._id).update({
      data: {
        status: previousStatus,
        previousStatus: '',
        updatedAt: db.serverDate(),
      },
    })

    await db.collection('review_logs').add({
      data: {
        targetType: 'cancel',
        targetId: booking._id,
        action: 'auto_reject_timeout',
        reason: '取消审核超时，自动驳回',
        reviewerId: 'system',
        createdAt: db.serverDate(),
      },
    })
    results.autoRejected += 1
  }
  return { success: true, data: results }
}
