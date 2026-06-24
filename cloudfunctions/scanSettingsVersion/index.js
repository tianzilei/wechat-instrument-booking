const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 50
const MIGRATION_MUTEX_DOC_ID = 'rule_migration_mutex'

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function ensureInternalOrAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return true
  const user = (await db.collection('users').where({ openid: OPENID }).field({ role: true }).limit(1).get()).data[0]
  return !!(user && user.role === 'admin')
}

function isWriteConflictError(err) {
  const text = String((err && (err.errMsg || err.message || err.code)) || '').toLowerCase()
  return text.includes('conflict')
}

function buildTaskId(rulesVersion) {
  return `rule_migration_${String(rulesVersion || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

async function runWithMigrationMutex(holder, callback) {
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.startTransaction()
    try {
      const mutexRef = transaction.collection('system_locks').doc(MIGRATION_MUTEX_DOC_ID)
      try {
        await mutexRef.get()
      } catch (err) {}
      await mutexRef.set({
        data: {
          holder,
          updatedAt: db.serverDate(),
        },
      })
      const result = await callback(transaction)
      await transaction.commit()
      return result
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
  throw lastErr || new Error('rule migration mutex failed')
}

async function tryGetDoc(docRef) {
  try {
    const res = await docRef.get()
    return res.data || null
  } catch (err) {
    return null
  }
}

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
  if (!(await ensureInternalOrAdmin())) {
    return fail('PERMISSION_DENIED', '无权限操作')
  }
  const settingsSnapshot = await tryGetDoc(db.collection('settings').doc('global'))
  if (!settingsSnapshot) return { success: true, data: { migrated: false, reason: 'no_settings' } }
  if (settingsSnapshot.processedRulesVersion >= settingsSnapshot.rulesVersion) {
    return { success: true, data: { migrated: false, reason: 'up_to_date' } }
  }
  const activeMigrations = await db.collection('rule_migration_tasks').where({
    rulesVersion: settingsSnapshot.rulesVersion,
    status: 'running',
  }).limit(1).get()

  if (activeMigrations.data.length > 0) {
    return { success: true, data: { migrated: false, reason: 'already_running', taskId: activeMigrations.data[0]._id } }
  }

  const holder = `scanSettingsVersion:${Date.now()}`
  const setup = await runWithMigrationMutex(holder, async (transaction) => {
    const settingsRef = transaction.collection('settings').doc('global')
    const settings = await tryGetDoc(settingsRef)
    if (!settings) return { migrated: false, reason: 'no_settings' }
    if (settings.processedRulesVersion >= settings.rulesVersion) {
      return { migrated: false, reason: 'up_to_date' }
    }

    const taskId = buildTaskId(settings.rulesVersion)
    const taskRef = transaction.collection('rule_migration_tasks').doc(taskId)
    const existingTask = await tryGetDoc(taskRef)
    if (existingTask && existingTask.status === 'running') {
      return { migrated: false, reason: 'already_running', taskId }
    }
    if (existingTask && existingTask.status === 'completed') {
      await settingsRef.update({
        data: { processedRulesVersion: settings.rulesVersion, serviceMode: 'normal', updatedAt: db.serverDate() },
      })
      return { migrated: false, reason: 'already_completed', taskId }
    }

    const now = db.serverDate()
    await taskRef.set({
      data: {
        _id: taskId,
        rulesVersion: settings.rulesVersion,
        status: 'running',
        cursor: 0,
        attempt: 0,
        createdAt: existingTask && existingTask.createdAt ? existingTask.createdAt : now,
        updatedAt: now,
      },
    })
    await settingsRef.update({
      data: { serviceMode: 'rule_migrating', updatedAt: now },
    })
    return {
      migrated: true,
      rulesVersion: settings.rulesVersion,
      openStartHour: settings.openStartHour || 9,
      openEndHour: settings.openEndHour || 18,
      taskId,
    }
  })

  if (!setup.migrated) {
    return { success: true, data: setup }
  }

  const now = db.serverDate()
  const OPEN_START_HOUR = setup.openStartHour
  const OPEN_END_HOUR = setup.openEndHour
  let affected = 0

  try {
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

    await db.collection('rule_migration_tasks').doc(setup.taskId).update({
      data: {
        status: 'completed',
        cursor: futureBookings.length,
        affectedBookings: affected,
        updatedAt: now,
      },
    })

    const latestSettings = await tryGetDoc(db.collection('settings').doc('global'))
    const nextServiceMode = latestSettings && latestSettings.rulesVersion > setup.rulesVersion ? 'rule_migrating' : 'normal'
    await db.collection('settings').doc('global').update({
      data: { processedRulesVersion: setup.rulesVersion, serviceMode: nextServiceMode, updatedAt: now },
    })

    return { success: true, data: { migrated: true, rulesVersion: setup.rulesVersion, affectedBookings: affected } }
  } catch (err) {
    await db.collection('rule_migration_tasks').doc(setup.taskId).update({
      data: {
        status: 'failed',
        lastErrorCode: err.code || err.errCode || 'UNKNOWN',
        updatedAt: now,
      },
    })
    return fail('MIGRATION_FAILED', '规则迁移执行失败')
  }
}
