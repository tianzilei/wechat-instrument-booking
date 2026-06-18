const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

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

function cancelFutureActiveSegments(segments, currentTime, nowServer, reasonCode) {
  let changed = false
  const nextSegments = (segments || []).map((segment) => {
    if (!isFutureActiveSegment(segment, currentTime)) return segment
    changed = true
    return {
      ...segment,
      state: 'cancelled',
      cancelledAt: nowServer,
      cancelReasonCode: reasonCode,
    }
  })
  return {
    changed,
    nextSegments,
    remainingSummary: summarizeActiveSegments(nextSegments),
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  if (!event.bookingId) return fail('INVALID_PARAMS', '参数错误')
  const bookingRes = await db.collection('bookings').doc(event.bookingId).field({
    userId: true, status: true, segments: true, previousStatus: true,
  }).get()
  const booking = bookingRes.data
  if (!booking || booking.userId !== user._id) return fail('PERMISSION_DENIED', '只能取消自己的预约')
  if (!['confirmed', 'pending_review'].includes(booking.status)) return fail('STATE_CHANGED', '当前状态不可取消')

  const now = new Date()
  const futureActive = (booking.segments || []).filter((segment) => isFutureActiveSegment(segment, now))
  if (futureActive.length === 0) return fail('STATE_CHANGED', '无未开始的有效时段')

  if (event.reason) {
    if (event.reason.length > 500) return fail('INVALID_PARAMS', '取消原因不超过 500 字')
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '取消说明包含违规信息')
      }
    } catch (err) {
      return fail('CONTENT_CHECK_FAILED', '取消说明内容安全校验失败，请稍后重试')
    }
  }

  const earliestFuture = futureActive.reduce((min, s) => (new Date(s.startAt) < new Date(min.startAt) ? s : min), futureActive[0])
  const hoursUntilStart = (new Date(earliestFuture.startAt) - now) / 3600000
  const needReview = hoursUntilStart < 12

  const nowServer = db.serverDate()
  if (needReview) {
    await db.collection('bookings').doc(event.bookingId).update({
      data: {
        status: 'cancel_pending',
        previousStatus: booking.status,
        cancellationNote: event.reason || '',
        updatedAt: nowServer,
      },
    })
    return ok({ bookingId: event.bookingId, status: 'cancel_pending', needReview: true })
  }

  const cancellation = cancelFutureActiveSegments(booking.segments, now, nowServer, 'user_cancelled')
  const nextStatus = cancellation.remainingSummary ? 'confirmed' : 'cancelled'

  await db.collection('bookings').doc(event.bookingId).update({
    data: {
      status: nextStatus,
      segments: cancellation.nextSegments,
      ...(cancellation.remainingSummary || {}),
      cancellationNote: event.reason || '',
      updatedAt: nowServer,
    },
  })

  return ok({ bookingId: event.bookingId, status: nextStatus, needReview: false })
}
