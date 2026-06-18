const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const ACTIVE_BOOKING_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']

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

function isWholeHour(date) {
  return date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function overlaps(startAt, endAt, targetStartAt, targetEndAt) {
  return startAt < targetEndAt && endAt > targetStartAt
}

function sumDurationHours(segments) {
  return segments.reduce((total, item) => total + ((new Date(item.endAt) - new Date(item.startAt)) / 3600000), 0)
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
  }
}

function buildBookingUpdate(preview, nowServer) {
  const { booking, hasSegments, affectedIndexes } = preview
  if (!hasSegments) {
    return {
      status: 'cancelled',
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

  if (activeSegments.length === 0) {
    updateData.status = 'cancelled'
    return updateData
  }

  updateData.firstStartAt = activeSegments[0].startAt
  updateData.lastEndAt = activeSegments[activeSegments.length - 1].endAt
  updateData.durationHours = sumDurationHours(activeSegments)
  return updateData
}

async function listOverlappingBookings(startAt, endAt) {
  const conditions = [
    {
      firstStartAt: _.lt(endAt),
      lastEndAt: _.gt(startAt),
    },
    {
      startAt: _.lt(endAt),
      endAt: _.gt(startAt),
    },
  ]
  const query = {
    status: _.in(ACTIVE_BOOKING_STATUSES),
    ...(conditions.length === 1 ? conditions[0] : _.or(conditions)),
  }
  let skip = 0
  let hasMore = true
  let items = []
  while (hasMore) {
    const batch = await db.collection('bookings').where(query).skip(skip).limit(100).get()
    items = items.concat(batch.data)
    if (batch.data.length < 100) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

async function collectAffectedPreviews(startAt, endAt, now) {
  const bookings = await listOverlappingBookings(startAt, endAt)
  return bookings
    .map((booking) => buildPreview(booking, startAt, endAt, now))
    .filter((item) => item.affected)
}

async function cancelAffectedBookings(startAt, endAt, nowServer, now) {
  const impactedIds = new Set()
  let hasChanges = true

  while (hasChanges) {
    hasChanges = false
    const previews = await collectAffectedPreviews(startAt, endAt, now)
    if (previews.length === 0) break

    for (const preview of previews) {
      impactedIds.add(preview.booking._id)
      await db.collection('bookings').doc(preview.booking._id).update({
        data: buildBookingUpdate(preview, nowServer),
      })
      hasChanges = true
    }
  }

  return [...impactedIds]
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
  const previews = await collectAffectedPreviews(startAt, endAt, now)
  if (event.previewOnly) {
    return ok({
      affectedBookingCount: previews.length,
      startAt,
      endAt,
      durationHours: (endAt - startAt) / 3600000,
    })
  }

  const nowServer = db.serverDate()
  const addRes = await db.collection('maintenance_slots').add({
    data: {
      startAt,
      endAt,
      reason: event.reason || '',
      createdBy: admin._id,
      cancelledBookingIds: [],
      cancelledBookingCount: 0,
      status: 'active',
      createdAt: nowServer,
      updatedAt: nowServer,
    },
  })

  const cancelledBookingIds = await cancelAffectedBookings(startAt, endAt, nowServer, now)

  await db.collection('maintenance_slots').doc(addRes._id).update({
    data: {
      cancelledBookingIds,
      cancelledBookingCount: cancelledBookingIds.length,
      updatedAt: nowServer,
    },
  })

  await db.collection('review_logs').add({
    data: { targetType: 'maintenance', targetId: addRes._id, action: 'create', reason: event.reason || '', reviewerId: admin._id, createdAt: nowServer },
  })

  return ok({ maintenanceId: addRes._id, cancelledBookingIds, affectedBookingCount: cancelledBookingIds.length })
}
