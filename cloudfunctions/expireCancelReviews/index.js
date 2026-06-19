const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function ensureInternalOrAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return true
  const user = (await db.collection('users').where({ openid: OPENID }).field({ role: true }).limit(1).get()).data[0]
  return !!(user && user.role === 'admin')
}

exports.main = async () => {
  if (!(await ensureInternalOrAdmin())) {
    return fail('PERMISSION_DENIED', '无权限操作')
  }
  const results = { processed: 0, autoRejected: 0 }
  while (true) {
    const now = new Date()
    const pending = await db.collection('bookings').where({
      status: 'cancel_pending',
      firstStartAt: db.command.lte(now),
    }).limit(50).get()
    if (pending.data.length === 0) break

    for (const booking of pending.data) {
      const previousStatus = booking.previousStatus || 'confirmed'
      if (!['confirmed', 'pending_review', 'rule_review_pending'].includes(previousStatus)) {
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
      results.processed += 1
      results.autoRejected += 1
    }
  }
  return { success: true, data: results }
}
