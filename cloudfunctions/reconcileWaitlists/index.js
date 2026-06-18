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
  const conditions = segments.map((s) => ({
    status: _.in(['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']),
    firstStartAt: _.lt(new Date(s.endAt)),
    lastEndAt: _.gt(new Date(s.startAt)),
  }))
  const query = conditions.length === 1
    ? conditions[0]
    : _.or(conditions)
  const res = await db.collection('bookings').where(query).limit(1).get()
  return res.data.length > 0
}
