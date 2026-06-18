const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 100
const UPDATE_BATCH_SIZE = 20

function chunk(items, size) {
  const batches = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

async function fetchAll(collectionName, where) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection(collectionName).where(where).skip(skip).limit(PAGE_SIZE).get()
    items.push(...batch.data)
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

async function updateDocs(collectionName, docs, buildData) {
  for (const batch of chunk(docs, UPDATE_BATCH_SIZE)) {
    await Promise.all(batch.map((doc) => db.collection(collectionName).doc(doc._id).update({
      data: buildData(doc),
    })))
  }
}

exports.main = async () => {
  const now = new Date()
  const leaseAt = new Date(now.getTime() + 4 * 60000)
  const results = { processed: 0, completed: 0, failed: 0 }

  const tasks = await db.collection('deletion_tasks').where(_.or([
    {
      status: _.in(['created', 'retrying']),
      nextRetryAt: _.lte(now),
    },
    {
      status: 'running',
      leaseUntil: _.lte(now),
    },
  ])).orderBy('createdAt', 'asc').limit(5).get()

  for (const task of tasks.data) {
    results.processed += 1
    try {
      await db.collection('deletion_tasks').doc(task._id).update({
        data: { status: 'running', leaseUntil: leaseAt, attempt: db.command.inc(1), updatedAt: db.serverDate() },
      })

      const userId = task.userId
      if (!task.cancelledBookings) {
        const bookings = await fetchAll('bookings', {
          userId,
          status: _.in(['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']),
        })
        await updateDocs('bookings', bookings, () => ({
          status: 'cancelled',
          cancellationNote: 'account_deleted',
          updatedAt: db.serverDate(),
        }))
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { cancelledBookings: bookings.length, updatedAt: db.serverDate() },
        })
      }

      if (!task.cancelledWaitlists) {
        const waitlists = await fetchAll('waitlists', {
          userId,
          status: _.nin(['cancelled', 'expired', 'converted']),
        })
        await updateDocs('waitlists', waitlists, () => ({
          status: 'cancelled',
          updatedAt: db.serverDate(),
        }))
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { cancelledWaitlists: waitlists.length, updatedAt: db.serverDate() },
        })
      }

      if (!task.anonymizedBookings) {
        const history = await fetchAll('bookings', { userId })
        await updateDocs('bookings', history, () => ({
          userId: '',
          userName: '',
          projectId: '',
          projectAbbr: '',
          projectAbbrDisplayCache: '',
          remark: '',
          reviewReason: '',
          cancellationNote: '',
          cancelReason: '',
          terminationReasonCode: '',
          updatedAt: db.serverDate(),
        }))
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { anonymizedBookings: history.length, updatedAt: db.serverDate() },
        })
      }

      if (!task.cleanedUpNotifications) {
        await db.collection('notifications').where({ userId }).remove()
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { cleanedUpNotifications: true, updatedAt: db.serverDate() },
        })
      }

      try {
        await db.collection('users').doc(userId).remove()
      } catch (err) {}
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
