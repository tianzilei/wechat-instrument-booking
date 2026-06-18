const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

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

function buildFutureActiveSegmentCancellationUpdate(booking, currentTime, nowServer, reasonCode, activeStatus) {
  let changed = false
  const nextSegments = (booking.segments || []).map((segment) => {
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
  return {
    status: hasFutureActiveSegments(nextSegments, currentTime) ? activeStatus : 'cancelled',
    previousStatus: '',
    segments: nextSegments,
    ...(remainingSummary || {}),
    updatedAt: nowServer,
  }
}

async function triggerWaitlistReconcile() {
  try {
    await cloud.callFunction({
      name: 'reconcileWaitlists',
      data: { source: 'reviewCancelV2' },
    })
  } catch (err) {}
}

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')

  if (!event.bookingId || !['approve', 'reject'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')
  const booking = (await db.collection('bookings').doc(event.bookingId).get()).data
  if (!booking || booking.status !== 'cancel_pending') return fail('STATE_CHANGED', '预约状态已变化')

  if (event.reason) {
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '拒绝原因包含违规信息')
      }
    } catch (err) {
      return fail('CONTENT_CHECK_FAILED', '拒绝原因内容安全校验失败，请稍后重试')
    }
  }

  const now = db.serverDate()
  let resultStatus = booking.previousStatus || 'confirmed'
  if (event.action === 'approve') {
    const currentTime = new Date()
    const updateData = buildFutureActiveSegmentCancellationUpdate(
      booking,
      currentTime,
      now,
      'cancel_approved',
      booking.previousStatus || 'confirmed'
    )
    if (!updateData) return fail('STATE_CHANGED', '无未开始的有效时段')
    resultStatus = updateData.status
    await db.collection('bookings').doc(event.bookingId).update({
      data: updateData,
    })
    await triggerWaitlistReconcile()
  } else {
    const previousStatus = booking.previousStatus || 'confirmed'
    if (!['confirmed', 'pending_review', 'rule_review_pending'].includes(previousStatus)) {
      return fail('STATE_CHANGED', '预约状态异常')
    }
    resultStatus = previousStatus
    await db.collection('bookings').doc(event.bookingId).update({
      data: { status: previousStatus, previousStatus: '', updatedAt: now },
    })
  }

  await db.collection('review_logs').add({
    data: {
      targetType: 'cancel', targetId: event.bookingId,
      action: event.action, reason: event.reason || '',
      reviewerId: admin._id, createdAt: now,
    },
  })

  return ok({ bookingId: event.bookingId, status: resultStatus })
}
