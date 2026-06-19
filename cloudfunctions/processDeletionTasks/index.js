const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 100
const UPDATE_BATCH_SIZE = 20

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function ensureInternalOrAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return true
  const user = (await db.collection('users').where({ openid: OPENID }).field({ role: true }).limit(1).get()).data[0]
  return !!(user && user.role === 'admin')
}

function chunk(items, size) {
  const batches = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

function isWriteConflictError(err) {
  const text = String((err && (err.errMsg || err.message || err.code)) || '').toLowerCase()
  return text.includes('conflict')
}

function canClaimTask(task, now) {
  if (!task) return false
  if ((task.status === 'created' || task.status === 'retrying') && (!task.nextRetryAt || new Date(task.nextRetryAt) <= now)) {
    return true
  }
  return task.status === 'running' && task.leaseUntil && new Date(task.leaseUntil) <= now
}

async function claimDeletionTask(taskId, now, leaseAt) {
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.startTransaction()
    try {
      const taskRef = transaction.collection('deletion_tasks').doc(taskId)
      const task = (await taskRef.get()).data
      if (!canClaimTask(task, now)) {
        await transaction.rollback()
        return null
      }
      const nextAttempt = (task.attempt || 0) + 1
      await taskRef.update({
        data: {
          status: 'running',
          leaseUntil: leaseAt,
          attempt: nextAttempt,
          updatedAt: db.serverDate(),
        },
      })
      await transaction.commit()
      return {
        ...task,
        attempt: nextAttempt,
        leaseUntil: leaseAt,
        status: 'running',
      }
    } catch (err) {
      lastErr = err
      try {
        await transaction.rollback()
      } catch (rollbackErr) {}
      if (!isWriteConflictError(err) || attempt === 2) {
        throw err
      }
    }
  }
  throw lastErr || new Error('claim deletion task failed')
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
  if (!(await ensureInternalOrAdmin())) {
    return fail('PERMISSION_DENIED', '无权限操作')
  }
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
    let claimedTask = null
    try {
      claimedTask = await claimDeletionTask(task._id, now, leaseAt)
      if (!claimedTask) continue
      results.processed += 1

      const userId = claimedTask.userId
      if (!claimedTask.cancelledBookings) {
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

      if (!claimedTask.cancelledWaitlists) {
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

      if (!claimedTask.anonymizedBookings) {
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

      if (!claimedTask.cleanedUpNotifications) {
        await db.collection('notifications').where({ userId }).remove()
        await db.collection('deletion_tasks').doc(task._id).update({
          data: { cleanedUpNotifications: true, updatedAt: db.serverDate() },
        })
      }

      if (!claimedTask.cleanedUpPrivacyRequests) {
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
        data: { status: 'completed', leaseUntil: null, completedAt: db.serverDate(), updatedAt: db.serverDate() },
      })
      results.completed += 1
    } catch (err) {
      if (!claimedTask) throw err
      const attempts = claimedTask.attempt || 1
      const maxAttempts = 5
      const status = attempts >= maxAttempts ? 'failed' : 'retrying'
      const nextRetry = new Date(now.getTime() + 5 * 60000)
      await db.collection('deletion_tasks').doc(task._id).update({
        data: {
          status,
          leaseUntil: null,
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
