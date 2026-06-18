const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 100

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
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
      status: remainingSummary ? 'cancelled' : 'cancelled',
      segments: nextSegments,
      cancellationNote: reasonCode,
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')

  if (!event.userId || !event.reason) return fail('INVALID_PARAMS', '缺少用户ID或暂停原因')
  if (event.reason.length > 500) return fail('INVALID_PARAMS', '暂停原因不超过 500 字')

  try {
    const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
    if (checkRes.result && checkRes.result.suggest === 'risky') {
      return fail('CONTENT_UNSAFE', '暂停原因包含违规信息')
    }
  } catch (err) {
    return fail('CONTENT_CHECK_FAILED', '暂停原因内容安全校验失败，请稍后重试')
  }

  const userRef = db.collection('users').doc(event.userId)
  const user = (await userRef.get()).data
  if (!user) return fail('NOT_FOUND', '用户不存在')
  if (user.accountStatus === 'suspended') return fail('STATE_CHANGED', '账号已被暂停')

  const now = db.serverDate()

  const bookings = await fetchAll('bookings', {
    userId: event.userId,
    status: _.in(['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']),
  })
  const bookingUpdates = bookings
    .map((booking) => ({ booking, update: buildFutureActiveSegmentCancellationUpdate(booking, now, 'account_suspended') }))
    .filter((item) => !!item.update)
  await Promise.all(bookingUpdates.map((item) => db.collection('bookings').doc(item.booking._id).update({
    data: item.update,
  })))

  const waitlists = await fetchAll('waitlists', {
    userId: event.userId,
    status: _.nin(['cancelled', 'expired', 'converted']),
  })
  await Promise.all(waitlists.map((w) => db.collection('waitlists').doc(w._id).update({
    data: { status: 'cancelled', updatedAt: now },
  })))

  await userRef.update({
    data: {
      accountStatus: 'suspended',
      suspendedReason: event.reason,
      suspendedAt: now,
      updatedAt: now,
    },
  })

  await db.collection('important_events').add({
    data: {
      userId: event.userId,
      type: 'account_suspended',
      summary: `账号已于 ${new Date().toISOString().slice(0, 10)} 暂停`,
      readAt: null,
      createdAt: now,
    },
  })

  await db.collection('review_logs').add({
    data: { targetType: 'user', targetId: event.userId, action: 'suspend', reason: event.reason, reviewerId: admin._id, createdAt: now },
  })

  return ok({ userId: event.userId, cancelledBookings: bookingUpdates.length, cancelledWaitlists: waitlists.length })
}
