const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async () => {
  const now = new Date()
  const results = { processed: 0, converted: 0, expired: 0, errors: 0 }

  const allWaitlists = await db.collection('waitlists').where({
    status: _.in(['waitlisted', 'confirming']),
  }).orderBy('createdAt', 'asc').limit(100).get()

  const scheduleKeys = [...new Set(allWaitlists.data.map((w) => w.scheduleKey || `${w.startAt}|${w.endAt}`))]
  for (const sk of scheduleKeys) {
    const waitlists = allWaitlists.data.filter((w) => (w.scheduleKey || `${w.startAt}|${w.endAt}`) === sk)
    for (const w of waitlists) {
      results.processed += 1
      try {
        if (w.status === 'confirming') {
          if (w.confirmDeadlineAt && new Date(w.confirmDeadlineAt) <= now) {
            await db.collection('waitlists').doc(w._id).update({
              data: { status: 'cancelled', updatedAt: db.serverDate() },
            })
            results.expired += 1
          }
          continue
        }
        if (w.status !== 'waitlisted') continue

        const segments = w.segments || w.occupiedSegments || [{ startAt: w.startAt, endAt: w.endAt }]
        const firstStartAt = segments.reduce((min, s) => {
          const d = new Date(s.startAt)
          return d < min ? d : min
        }, new Date(segments[0].startAt))
        if (firstStartAt <= now) {
          await db.collection('waitlists').doc(w._id).update({
            data: { status: 'expired', updatedAt: db.serverDate() },
          })
          results.expired += 1
          continue
        }

        const hasConflict = await checkSegmentConflict(segments)
        if (!hasConflict) {
          await db.collection('waitlists').doc(w._id).update({
            data: {
              status: 'confirming',
              confirmDeadlineAt: new Date(now.getTime() + 2 * 3600000),
              updatedAt: db.serverDate(),
            },
          })
          results.converted += 1
        }
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
    status: _.in(['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming']),
    startAt: _.lt(new Date(s.endAt)),
    endAt: _.gt(new Date(s.startAt)),
  }))
  const query = conditions.length === 1
    ? conditions[0]
    : _.or(conditions)
  const res = await db.collection('bookings').where(query).limit(1).get()
  return res.data.length > 0
}
