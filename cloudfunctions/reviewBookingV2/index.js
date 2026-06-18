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

function getFutureSegmentReviewUpdate(booking, nowServer, reasonCode, nextStatus) {
  const currentTime = new Date()
  const nextSegments = (booking.segments || []).map((segment) => {
    if (!isFutureActiveSegment(segment, currentTime)) return segment
    return {
      ...segment,
      state: 'cancelled',
      cancelledAt: nowServer,
      cancelReasonCode: reasonCode,
    }
  })
  const remainingSummary = summarizeActiveSegments(nextSegments)
  const updateData = {
    status: nextStatus,
    segments: nextSegments,
    previousStatus: '',
    updatedAt: nowServer,
  }
  Object.assign(updateData, remainingSummary || {})
  return updateData
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
  if (!booking || !['pending_review', 'rule_review_pending'].includes(booking.status)) return fail('STATE_CHANGED', '预约状态已变化')

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
  if (event.action === 'reject') {
    if (booking.status === 'rule_review_pending') {
      await db.collection('bookings').doc(event.bookingId).update({
        data: {
          ...getFutureSegmentReviewUpdate(booking, now, 'rule_review_rejected', 'rule_rejected'),
          reviewReason: event.reason || '',
          reviewedBy: admin._id,
          reviewedAt: now,
        },
      })
      if (booking.userId) {
        await db.collection('important_events').add({
          data: {
            userId: booking.userId,
            type: 'rule_review_rejected',
            summary: '预约因规则复审未通过，未来时段已取消',
            readAt: null,
            createdAt: now,
          },
        })
      }
    } else {
      const segments = (booking.segments || []).map((s) => ({
        ...s,
        state: 'cancelled',
        cancelledAt: now,
        cancelReasonCode: 'review_rejected',
      }))
      await db.collection('bookings').doc(event.bookingId).update({
        data: { status: 'rejected', previousStatus: '', segments, reviewReason: event.reason || '', reviewedBy: admin._id, reviewedAt: now, updatedAt: now },
      })
    }
  } else {
    await db.collection('bookings').doc(event.bookingId).update({
      data: {
        status: booking.status === 'rule_review_pending' ? (booking.previousStatus || 'confirmed') : 'confirmed',
        previousStatus: '',
        reviewedBy: admin._id,
        reviewedAt: now,
        updatedAt: now,
      },
    })
  }

  await db.collection('review_logs').add({
    data: {
      targetType: 'booking', targetId: event.bookingId,
      action: event.action, reason: event.reason || '',
      reviewerId: admin._id, createdAt: now,
    },
  })

  return ok({
    bookingId: event.bookingId,
    status: event.action === 'approve'
      ? (booking.status === 'rule_review_pending' ? (booking.previousStatus || 'confirmed') : 'confirmed')
      : (booking.status === 'rule_review_pending' ? 'rule_rejected' : 'rejected'),
  })
}
