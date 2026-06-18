const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function fetchAllWaitlists() {
  const items = []
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const batch = await db.collection('waitlists').where({
      status: _.in(['waitlisted', 'confirming']),
    }).orderBy('createdAt', 'asc').skip(skip).limit(100).get()
    items.push(...batch.data)
    if (batch.data.length < 100) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

function getWaitlistScheduleKey(waitlist) {
  return waitlist.scheduleKey || `${waitlist.startAt}|${waitlist.endAt}`
}

function getWaitlistSegments(waitlist) {
  return waitlist.segments || waitlist.occupiedSegments || [{ startAt: waitlist.startAt, endAt: waitlist.endAt }]
}

function getEarliestStartAt(segments) {
  return segments.reduce((min, segment) => {
    const value = new Date(segment.startAt)
    return value < min ? value : min
  }, new Date(segments[0].startAt))
}

function buildConfirmDeadline(now, earliestStartAt) {
  const twoHoursLater = new Date(now.getTime() + 2 * 3600000)
  return earliestStartAt < twoHoursLater ? earliestStartAt : twoHoursLater
}

function getComparableSegments(segments) {
  return (segments || [])
    .map((segment) => ({
      startAt: new Date(segment.startAt),
      endAt: new Date(segment.endAt),
    }))
    .filter((segment) => segment.startAt < segment.endAt)
}

function getBookingActiveSegments(booking) {
  if (Array.isArray(booking.segments) && booking.segments.length > 0) {
    return getComparableSegments(
      booking.segments.filter((segment) => (segment.state || 'active') !== 'cancelled')
    )
  }
  return getComparableSegments([{
    startAt: booking.firstStartAt || booking.startAt,
    endAt: booking.lastEndAt || booking.endAt,
  }])
}

function hasSegmentsOverlap(leftSegments, rightSegments) {
  for (const left of leftSegments) {
    for (const right of rightSegments) {
      if (left.startAt < right.endAt && left.endAt > right.startAt) return true
    }
  }
  return false
}

function sortWaitlists(left, right) {
  const leftQueue = typeof left.queueOrder === 'number' ? left.queueOrder : Number.MAX_SAFE_INTEGER
  const rightQueue = typeof right.queueOrder === 'number' ? right.queueOrder : Number.MAX_SAFE_INTEGER
  if (leftQueue !== rightQueue) return leftQueue - rightQueue
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
}

exports.main = async () => {
  const now = new Date()
  const results = { processed: 0, converted: 0, expired: 0, errors: 0 }

  const allWaitlists = await fetchAllWaitlists()
  const scheduleKeys = [...new Set(allWaitlists.map((waitlist) => getWaitlistScheduleKey(waitlist)))]
  for (const sk of scheduleKeys) {
    const waitlists = allWaitlists
      .filter((waitlist) => getWaitlistScheduleKey(waitlist) === sk)
      .sort(sortWaitlists)
    let activeConfirming = false

    for (const waitlist of waitlists) {
      results.processed += 1
      try {
        const segments = getWaitlistSegments(waitlist)
        const firstStartAt = getEarliestStartAt(segments)

        if (waitlist.status === 'confirming') {
          const confirmDeadlineAt = waitlist.confirmDeadlineAt ? new Date(waitlist.confirmDeadlineAt) : firstStartAt
          if (confirmDeadlineAt <= now || firstStartAt <= now) {
            await db.collection('waitlists').doc(waitlist._id).update({
              data: { status: 'expired', updatedAt: db.serverDate() },
            })
            results.expired += 1
            continue
          }
          activeConfirming = true
          break
        }

        if (waitlist.status !== 'waitlisted') continue
        if (activeConfirming) break

        if (firstStartAt <= now) {
          await db.collection('waitlists').doc(waitlist._id).update({
            data: { status: 'expired', updatedAt: db.serverDate() },
          })
          results.expired += 1
          continue
        }

        const hasConflict = await checkSegmentConflict(segments)
        if (hasConflict) break

        await db.collection('waitlists').doc(waitlist._id).update({
          data: {
            status: 'confirming',
            confirmDeadlineAt: buildConfirmDeadline(now, firstStartAt),
            updatedAt: db.serverDate(),
          },
        })
        results.converted += 1
        break
      } catch (err) {
        results.errors += 1
        console.error('reconcile error:', err.errCode || err.message)
      }
    }
  }
  return { success: true, data: results }
}

async function checkSegmentConflict(segments) {
  const requestSegments = getComparableSegments(segments)
  const sharedFilter = { status: _.in(['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']) }
  const v2Conditions = requestSegments.map((segment) => ({
    ...sharedFilter,
    firstStartAt: _.lt(segment.endAt),
    lastEndAt: _.gt(segment.startAt),
  }))
  const v1Conditions = requestSegments.map((segment) => ({
    ...sharedFilter,
    startAt: _.lt(segment.endAt),
    endAt: _.gt(segment.startAt),
  }))
  const conditions = [...v2Conditions, ...v1Conditions]
  if (conditions.length === 0) return false
  const query = conditions.length === 1 ? conditions[0] : _.or(conditions)
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const batch = await db.collection('bookings').where(query).field({
      segments: true,
      firstStartAt: true,
      lastEndAt: true,
      startAt: true,
      endAt: true,
    }).skip(skip).limit(100).get()
    const conflictFound = batch.data.some((booking) => hasSegmentsOverlap(requestSegments, getBookingActiveSegments(booking)))
    if (conflictFound) return true
    if (batch.data.length < 100) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return false
}
