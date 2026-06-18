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

function isFutureActiveSegment(segment, currentTime) {
  return (segment.state || 'active') === 'active' && new Date(segment.startAt) > currentTime
}

function summarizeActiveSegments(segments) {
  const activeSegments = (segments || []).filter((segment) => (segment.state || 'active') === 'active')
  if (activeSegments.length === 0) return null
  return {
    firstStartAt: activeSegments[0].startAt,
    lastEndAt: activeSegments[activeSegments.length - 1].endAt,
    durationHours: activeSegments.reduce((sum, segment) => sum + ((new Date(segment.endAt) - new Date(segment.startAt)) / 3600000), 0),
  }
}

function hasFutureActiveSegments(segments, currentTime) {
  return (segments || []).some((segment) => isFutureActiveSegment(segment, currentTime))
}

function buildFutureActiveSegmentCancellationUpdate(booking, nowServer, reasonCode) {
  const currentTime = new Date()
  const segments = Array.isArray(booking.segments) ? booking.segments : []
  if (segments.length > 0) {
    let changed = false
    const nextSegments = segments.map((segment) => {
      if (!isFutureActiveSegment(segment, currentTime)) return segment
      changed = true
      return {
        ...segment,
        state: 'cancelled',
        cancelledAt: nowServer,
        cancelReasonCode: reasonCode,
      }
    })
    if (!changed) return null
    const remainingSummary = summarizeActiveSegments(nextSegments)
    const updateData = {
      status: hasFutureActiveSegments(nextSegments, currentTime) ? booking.status : 'cancelled',
      segments: nextSegments,
      cancellationNote: reasonCode,
      previousStatus: '',
      updatedAt: nowServer,
    }
    Object.assign(updateData, remainingSummary || {})
    return updateData
  }

  const startAt = new Date(booking.firstStartAt || booking.startAt)
  if (startAt <= currentTime) return null
  return {
    status: 'cancelled',
    cancellationNote: reasonCode,
    updatedAt: nowServer,
  }
}

async function triggerWaitlistReconcile() {
  try {
    await cloud.callFunction({
      name: 'reconcileWaitlists',
      data: { source: 'processDeletionTasks' },
    })
  } catch (err) {}
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
        const bookingUpdates = bookings
          .map((booking) => ({ _id: booking._id, update: buildFutureActiveSegmentCancellationUpdate(booking, db.serverDate(), 'account_deleted') }))
          .filter((item) => !!item.update)
        await updateDocs('bookings', bookingUpdates, (item) => item.update)
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { cancelledBookings: bookingUpdates.length, updatedAt: db.serverDate() },
        })
        if (bookingUpdates.length > 0) {
          await triggerWaitlistReconcile()
        }
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
        if (waitlists.length > 0) {
          await triggerWaitlistReconcile()
        }
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

      if (!task.cleanedUpPrivacyRequests) {
        const privacyRequests = await fetchAll('privacy_requests', { userId })
        await updateDocs('privacy_requests', privacyRequests, () => ({
          userId: '',
          note: '',
          processNote: '',
          updatedAt: db.serverDate(),
        }))
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { cleanedUpPrivacyRequests: true, updatedAt: db.serverDate() },
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
