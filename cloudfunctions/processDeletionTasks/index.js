const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async () => {
  const now = new Date()
  const leaseAt = new Date(now.getTime() + 4 * 60000)
  const results = { processed: 0, completed: 0, failed: 0 }

  const tasks = await db.collection('deletion_tasks').where({
    status: _.in(['created', 'retrying']),
    nextRetryAt: _.lte(now),
  }).orderBy('createdAt', 'asc').limit(5).get()

  for (const task of tasks.data) {
    results.processed += 1
    try {
      await db.collection('deletion_tasks').doc(task._id).update({
        data: { status: 'running', leaseUntil: leaseAt, attempt: db.command.inc(1), updatedAt: db.serverDate() },
      })

      const userId = task.userId
      if (!task.cancelledBookings) {
        const bookings = await db.collection('bookings').where({
          userId,
          status: _.in(['pending_review', 'confirmed', 'cancel_pending']),
        }).get()
        await Promise.all(bookings.data.map((b) => db.collection('bookings').doc(b._id).update({
          data: { status: 'cancelled', cancellationNote: 'account_deleted', updatedAt: db.serverDate() },
        })))
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { cancelledBookings: bookings.data.length, updatedAt: db.serverDate() },
        })
      }

      if (!task.cancelledWaitlists) {
        const waitlists = await db.collection('waitlists').where({
          userId,
          status: _.nin(['cancelled', 'expired']),
        }).get()
        await Promise.all(waitlists.data.map((w) => db.collection('waitlists').doc(w._id).update({
          data: { status: 'cancelled', updatedAt: db.serverDate() },
        })))
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { cancelledWaitlists: waitlists.data.length, updatedAt: db.serverDate() },
        })
      }

      if (!task.anonymizedBookings) {
        const history = await db.collection('bookings').where({ userId }).limit(500).get()
        await Promise.all(history.data.map((b) => db.collection('bookings').doc(b._id).update({
          data: {
            userId: '',
            projectId: '',
            projectAbbrDisplayCache: '',
            remark: '',
            reviewReason: '',
            cancellationNote: '',
            cancelReason: '',
            terminationReasonCode: '',
            updatedAt: db.serverDate(),
          },
        })))
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { anonymizedBookings: history.data.length, updatedAt: db.serverDate() },
        })
      }

      if (!task.cleanedUpNotifications) {
        await db.collection('notifications').where({ userId }).remove()
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { cleanedUpNotifications: true, updatedAt: db.serverDate() },
        })
      }

      await db.collection('users').doc(userId).remove()
      await db.collection('deletion_tasks').doc(task._id).update({
        data: { status: 'completed', completedAt: db.serverDate(), updatedAt: db.serverDate() },
      })
      results.completed += 1
    } catch (err) {
      const attempts = (task.attempt || 0) + 1
      const maxAttempts = 5
      const status = attempts >= maxAttempts ? 'failed' : 'retrying'
      const nextRetry = new Date(now.getTime() + 5 * 60000)
      await db.collection('deletion_tasks').doc(task._id).update({
        data: {
          status,
          nextRetryAt: status === 'retrying' ? nextRetry : null,
          lastErrorCode: (err.code || err.errCode || 'UNKNOWN'),
          updatedAt: db.serverDate(),
        },
      })
      if (status === 'failed') results.failed += 1
    }
  }

  return { success: true, data: results }
}
