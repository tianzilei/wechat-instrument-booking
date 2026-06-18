const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const ACTIVE_BOOKING_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']
const BOOKING_MUTEX_DOC_ID = 'booking_schedule_mutex'
const PAGE_SIZE = 100

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

function isWriteConflictError(err) {
  const text = String((err && (err.errMsg || err.message || err.code)) || '').toLowerCase()
  return text.includes('conflict')
}

async function runWithBookingMutex(holder, callback) {
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.startTransaction()
    try {
      const mutexRef = transaction.collection('system_locks').doc(BOOKING_MUTEX_DOC_ID)
      await mutexRef.get()
      await mutexRef.set({
        data: {
          _id: BOOKING_MUTEX_DOC_ID,
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
  throw lastErr || new Error('booking mutex failed')
}

function isWholeHour(date) {
  return date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function overlaps(startAt, endAt, targetStartAt, targetEndAt) {
  return startAt < targetEndAt && endAt > targetStartAt
}

function summarizeActiveSegments(segments) {
  const activeSegments = (segments || []).filter((segment) => (segment.state || 'active') !== 'cancelled')
  if (activeSegments.length === 0) return null
  return {
    firstStartAt: activeSegments[0].startAt,
    lastEndAt: activeSegments[activeSegments.length - 1].endAt,
    durationHours: activeSegments.reduce((total, item) => total + ((new Date(item.endAt) - new Date(item.startAt)) / 3600000), 0),
  }
}

function hasFutureActiveSegments(segments, currentTime) {
  return (segments || []).some((segment) => {
    const state = segment.state || 'active'
    return state !== 'cancelled' && new Date(segment.startAt) > currentTime
  })
}

function buildPreview(booking, startAt, endAt, now) {
  const hasSegments = Array.isArray(booking.segments) && booking.segments.length > 0
  if (hasSegments) {
    const affectedIndexes = booking.segments.reduce((indexes, segment, index) => {
      const segmentStart = new Date(segment.startAt)
      const segmentEnd = new Date(segment.endAt)
      const state = segment.state || 'active'
      if (state === 'cancelled') return indexes
      if (segmentStart <= now) return indexes
      if (!overlaps(segmentStart, segmentEnd, startAt, endAt)) return indexes
      indexes.push(index)
      return indexes
    }, [])
    return {
      booking,
      hasSegments: true,
      affectedIndexes,
      affected: affectedIndexes.length > 0,
      currentTime: now,
    }
  }

  const legacyStartAt = new Date(booking.firstStartAt || booking.startAt)
  const legacyEndAt = new Date(booking.lastEndAt || booking.endAt)
  const affected = legacyStartAt > now && overlaps(legacyStartAt, legacyEndAt, startAt, endAt)
  return {
    booking,
    hasSegments: false,
    affectedIndexes: affected ? [0] : [],
    affected,
    currentTime: now,
  }
}

function buildBookingUpdate(preview, nowServer) {
  const { booking, hasSegments, affectedIndexes, currentTime } = preview
  if (!hasSegments) {
    return {
      status: 'maintenance_cancelled',
      cancellationNote: 'maintenance_cancelled',
      updatedAt: nowServer,
    }
  }

  const affectedSet = new Set(affectedIndexes)
  const nextSegments = booking.segments.map((segment, index) => {
    if (!affectedSet.has(index)) return segment
    return {
      ...segment,
      state: 'cancelled',
      cancelledAt: nowServer,
      cancelReasonCode: 'maintenance_cancelled',
    }
  })
  const activeSegments = nextSegments.filter((segment) => (segment.state || 'active') !== 'cancelled')
  const updateData = {
    segments: nextSegments,
    cancellationNote: 'maintenance_cancelled',
    updatedAt: nowServer,
  }
  const remainingSummary = summarizeActiveSegments(nextSegments)
  if (!hasFutureActiveSegments(nextSegments, currentTime)) {
    updateData.status = 'maintenance_cancelled'
    if (!remainingSummary) {
      return updateData
    }
    Object.assign(updateData, remainingSummary)
    return updateData
  }
  Object.assign(updateData, remainingSummary)
  return updateData
}

async function listOverlappingBookings(collectionRef, startAt, endAt) {
  const conditions = [
    {
      status: _.in(ACTIVE_BOOKING_STATUSES),
      firstStartAt: _.lt(endAt),
      lastEndAt: _.gt(startAt),
    },
    {
      status: _.in(ACTIVE_BOOKING_STATUSES),
      startAt: _.lt(endAt),
      endAt: _.gt(startAt),
    },
  ]
  const query = conditions.length === 1 ? conditions[0] : _.or(conditions)
  let skip = 0
  let hasMore = true
  let items = []
  while (hasMore) {
    const batch = await collectionRef.where(query).skip(skip).limit(PAGE_SIZE).get()
    items = items.concat(batch.data)
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

async function collectAffectedPreviews(collectionRef, startAt, endAt, now) {
  const bookings = await listOverlappingBookings(collectionRef, startAt, endAt)
  return bookings
    .map((booking) => buildPreview(booking, startAt, endAt, now))
    .filter((item) => item.affected)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')
  const startAt = new Date(event.startAt)
  const endAt = new Date(event.endAt)
  if (!isValidDate(startAt) || !isValidDate(endAt) || !(startAt < endAt)) return fail('INVALID_PARAMS', '时间参数错误')
  if (!isWholeHour(startAt) || !isWholeHour(endAt)) return fail('INVALID_PARAMS', '维护时间必须为整点')

  if (event.reason) {
    if (event.reason.length > 500) return fail('INVALID_PARAMS', '维护原因不超过 500 字')
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '维护说明包含违规信息，请修改后重试')
      }
    } catch (err) {
      return fail('CONTENT_CHECK_FAILED', '维护说明内容安全校验失败，请稍后重试')
    }
  }

  const now = new Date()
  const previews = await collectAffectedPreviews(db.collection('bookings'), startAt, endAt, now)
  if (event.previewOnly) {
    return ok({
      affectedBookingCount: previews.length,
      startAt,
      endAt,
      durationHours: (endAt - startAt) / 3600000,
    })
  }

  try {
    const result = await runWithBookingMutex(`maintenance:${startAt.toISOString()}_${endAt.toISOString()}`, async (transaction) => {
      const latestPreviews = await collectAffectedPreviews(transaction.collection('bookings'), startAt, endAt, new Date())
      const cancelledBookingIds = latestPreviews.map((preview) => preview.booking._id)
      const nowServer = db.serverDate()
      const addRes = await transaction.collection('maintenance_slots').add({
        data: {
          startAt,
          endAt,
          reason: event.reason || '',
          createdBy: admin._id,
          cancelledBookingIds,
          cancelledBookingCount: cancelledBookingIds.length,
          status: 'active',
          createdAt: nowServer,
          updatedAt: nowServer,
        },
      })

      for (const preview of latestPreviews) {
        await transaction.collection('bookings').doc(preview.booking._id).update({
          data: buildBookingUpdate(preview, nowServer),
        })
      }

      await transaction.collection('review_logs').add({
        data: {
          targetType: 'maintenance',
          targetId: addRes._id,
          action: 'create',
          reason: event.reason || '',
          reviewerId: admin._id,
          createdAt: nowServer,
        },
      })

      return {
        maintenanceId: addRes._id,
        cancelledBookingIds,
      }
    })

    return ok({
      maintenanceId: result.maintenanceId,
      cancelledBookingIds: result.cancelledBookingIds,
      affectedBookingCount: result.cancelledBookingIds.length,
    })
  } catch (err) {
    if (err && err.code) return fail(err.code, err.message)
    return fail('SYSTEM_BUSY', '系统繁忙，请稍后重试')
  }
}
