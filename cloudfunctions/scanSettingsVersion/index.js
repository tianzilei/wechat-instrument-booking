const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 50

async function fetchAllFutureConfirmedBookings() {
  const items = []
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const batch = await db.collection('bookings').where({
      status: 'confirmed',
      firstStartAt: db.command.gt(new Date()),
    }).skip(skip).limit(PAGE_SIZE).get()
    items.push(...batch.data)
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

exports.main = async () => {
  let settings = null
  try {
    const res = await db.collection('settings').doc('global').get()
    settings = res.data
  } catch (err) {}
  if (!settings) return { success: true, data: { migrated: false, reason: 'no_settings' } }

  if (settings.processedRulesVersion >= settings.rulesVersion) {
    return { success: true, data: { migrated: false, reason: 'up_to_date' } }
  }

  const activeMigrations = await db.collection('rule_migration_tasks').where({
    rulesVersion: settings.rulesVersion,
    status: _.in(['running', 'completed']),
  }).limit(1).get()

  if (activeMigrations.data.length > 0) {
    return { success: true, data: { migrated: false, reason: 'already_running', taskId: activeMigrations.data[0]._id } }
  }

  const now = db.serverDate()
  const taskRes = await db.collection('rule_migration_tasks').add({
    data: {
      rulesVersion: settings.rulesVersion,
      status: 'running',
      cursor: 0,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    },
  })

  await db.collection('settings').doc('global').update({
    data: { serviceMode: 'rule_migrating', updatedAt: now },
  })

  const OPEN_START_HOUR = settings.openStartHour || 9
  const OPEN_END_HOUR = settings.openEndHour || 18
  let affected = 0

  const futureBookings = await fetchAllFutureConfirmedBookings()
  for (const booking of futureBookings) {
    const segments = booking.segments || [{ startAt: booking.startAt, endAt: booking.endAt }]
    const hitNewRule = segments.some((s) => {
      const d = new Date(s.startAt)
      if (d.getDay() === 0 || d.getDay() === 6) return true
      if (d.getHours() < OPEN_START_HOUR || d.getHours() >= OPEN_END_HOUR) return true
      return false
    })
    if (hitNewRule) {
      await db.collection('bookings').doc(booking._id).update({
        data: {
          status: 'rule_review_pending',
          previousStatus: booking.status,
          updatedAt: now,
        },
      })
      affected += 1
    }
  }

  await db.collection('rule_migration_tasks').doc(taskRes._id).update({
    data: {
      status: 'completed',
      cursor: futureBookings.length,
      affectedBookings: affected,
      updatedAt: now,
    },
  })

  await db.collection('settings').doc('global').update({
    data: { processedRulesVersion: settings.rulesVersion, serviceMode: 'normal', updatedAt: now },
  })

  return { success: true, data: { migrated: true, rulesVersion: settings.rulesVersion, affectedBookings: affected } }
}
