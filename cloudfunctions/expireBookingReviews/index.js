const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async () => {
  const results = { processed: 0, timedOut: 0 }
  while (true) {
    const now = new Date()
    const pending = await db.collection('bookings').where({
      status: 'pending_review',
      firstStartAt: db.command.lte(now),
    }).limit(50).get()
    if (pending.data.length === 0) break

    for (const booking of pending.data) {
      const segments = (booking.segments || []).map((s) => ({
        ...s,
        state: s.state === 'active' ? 'cancelled' : s.state,
        cancelledAt: db.serverDate(),
        cancelReasonCode: 'review_timeout',
      }))
      await db.collection('bookings').doc(booking._id).update({
        data: {
          status: 'review_timeout',
          segments,
          updatedAt: db.serverDate(),
        },
      })
      await db.collection('review_logs').add({
        data: { targetType: 'booking', targetId: booking._id, action: 'auto_timeout', reason: '审核超时自动释放', reviewerId: 'system', createdAt: db.serverDate() },
      })
      results.processed += 1
      results.timedOut += 1
    }
  }
  return { success: true, data: results }
}
