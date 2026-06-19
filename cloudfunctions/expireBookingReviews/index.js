const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function ensureInternalOrAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return true
  const user = (await db.collection('users').where({ openid: OPENID }).field({ role: true }).limit(1).get()).data[0]
  return !!(user && user.role === 'admin')
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

function buildFutureSegmentReleaseUpdate(booking, currentTime, nowServer, nextStatus, reasonCode) {
  if (!Array.isArray(booking.segments) || booking.segments.length === 0) return null

  const nextSegments = booking.segments.map((segment) => {
    if (!isFutureActiveSegment(segment, currentTime)) return segment
    return {
      ...segment,
      state: 'cancelled',
      cancelledAt: nowServer,
      cancelReasonCode: reasonCode,
    }
  })

  const remainingSummary = summarizeActiveSegments(nextSegments)
  return {
    status: nextStatus,
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
      data: { source: 'expireBookingReviews' },
    })
  } catch (err) {}
}

exports.main = async () => {
  if (!(await ensureInternalOrAdmin())) {
    return fail('PERMISSION_DENIED', '无权限操作')
  }
  const results = { processed: 0, timedOut: 0 }
  while (true) {
    const now = new Date()
    const pending = await db.collection('bookings').where({
      status: _.in(['pending_review', 'rule_review_pending']),
      firstStartAt: db.command.lte(now),
    }).limit(50).get()
    if (pending.data.length === 0) break

    for (const booking of pending.data) {
      const currentTime = new Date()
      const isRuleReview = booking.status === 'rule_review_pending'
      const nextStatus = isRuleReview ? 'rule_rejected' : 'review_timeout'
      const logAction = isRuleReview ? 'rule_auto_timeout' : 'auto_timeout'
      const logReason = isRuleReview ? '规则复审超时，未来时段已取消' : '审核超时自动释放'
      const nowServer = db.serverDate()
      const updateData = buildFutureSegmentReleaseUpdate(
        booking,
        currentTime,
        nowServer,
        nextStatus,
        isRuleReview ? 'rule_review_timeout' : 'review_timeout'
      ) || {
        status: nextStatus,
        previousStatus: '',
        updatedAt: nowServer,
      }

      await db.collection('bookings').doc(booking._id).update({
        data: updateData,
      })
      await db.collection('review_logs').add({
        data: { targetType: 'booking', targetId: booking._id, action: logAction, reason: logReason, reviewerId: 'system', createdAt: db.serverDate() },
      })
      results.processed += 1
      results.timedOut += 1
    }
    if (pending.data.length > 0) {
      await triggerWaitlistReconcile()
    }
  }
  return { success: true, data: results }
}
