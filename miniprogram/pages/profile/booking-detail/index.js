const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')
const { getBookingStatus } = require('../../../utils/status')

const SPECIAL_RULE_LABELS = {
  night: '非工作时间',
  weekend: '周末',
}

const REVIEW_ACTION_LABELS = {
  booking: {
    approve: '预约审核通过',
    reject: '预约审核拒绝',
    auto_timeout: '预约审核超时',
    rule_auto_timeout: '规则复审超时',
  },
  cancel: {
    approve: '取消申请已通过',
    reject: '取消申请已驳回',
    auto_reject_timeout: '取消申请超时自动驳回',
  },
}

const CANCELLATION_REASON_LABELS = {
  user_cancelled: '用户已取消未来时段',
  cancel_approved: '取消申请已通过，未来时段已取消',
  maintenance_cancelled: '维护导致未来时段取消',
  review_rejected: '预约审核拒绝，未来时段已释放',
  review_timeout: '预约审核超时，未来时段已释放',
  rule_review_rejected: '规则复审未通过，未来时段已取消',
  rule_review_timeout: '规则复审超时，未来时段已取消',
  account_suspended: '账号暂停导致未来时段取消',
  project_inactive: '课题停用导致未来时段取消',
  account_deleted: '账号注销导致未来时段取消',
}

const SEGMENT_REASON_EVENT_CODES = new Set([
  'user_cancelled',
  'maintenance_cancelled',
  'review_rejected',
  'review_timeout',
  'rule_review_rejected',
  'rule_review_timeout',
  'account_suspended',
  'project_inactive',
  'account_deleted',
])

function getDisplayStatus(status, endAt) {
  if (status === 'confirmed' && new Date(endAt) <= new Date()) {
    return getBookingStatus('completed')
  }
  return getBookingStatus(status)
}

function formatCancellationReason(reason) {
  return CANCELLATION_REASON_LABELS[reason] || reason || ''
}

function getReviewActionText(log) {
  const targetType = log.targetType || 'booking'
  return (REVIEW_ACTION_LABELS[targetType] && REVIEW_ACTION_LABELS[targetType][log.action]) || log.action || '未知操作'
}

function getReviewReasonText(log) {
  if (log.reason) return formatCancellationReason(log.reason)
  if (['auto_timeout', 'rule_auto_timeout', 'auto_reject_timeout'].includes(log.action)) {
    return '系统自动处理'
  }
  return ''
}

function getSegmentStatus(segment) {
  if ((segment.state || 'active') === 'cancelled') {
    return {
      text: '已取消',
      tone: 'muted',
      reasonText: formatCancellationReason(segment.cancelReasonCode),
    }
  }
  if (new Date(segment.endAt) <= new Date()) {
    return { text: '已结束', tone: 'muted', reasonText: '' }
  }
  return { text: '有效', tone: 'success', reasonText: '' }
}

function groupSegmentEvents(segments) {
  const grouped = {}
  ;(segments || []).forEach((segment) => {
    const reasonCode = segment.cancelReasonCode || ''
    const cancelledAt = segment.cancelledAt
    if (!reasonCode || !cancelledAt || !SEGMENT_REASON_EVENT_CODES.has(reasonCode)) return
    const key = `${new Date(cancelledAt).getTime()}_${reasonCode}`
    if (!grouped[key]) {
      grouped[key] = {
        createdAt: cancelledAt,
        reasonCode,
        count: 0,
      }
    }
    grouped[key].count += 1
  })
  return Object.keys(grouped).map((key) => {
    const item = grouped[key]
    return {
      createdAt: item.createdAt,
      title: formatCancellationReason(item.reasonCode),
      detail: item.count > 1 ? `共影响 ${item.count} 段未来时段` : '影响 1 段未来时段',
    }
  })
}

function groupSegmentsByDate(segments) {
  const groups = {}
  ;(segments || []).forEach((segment) => {
    const key = dateUtils.formatDate(segment.startAt)
    if (!groups[key]) groups[key] = []
    groups[key].push(segment)
  })
  return Object.keys(groups).sort().map((date) => ({
    date,
    title: date,
    items: groups[date],
  }))
}

function buildFallbackStatusEvent(booking, events) {
  const hasFinalTimeline = events.some((item) => {
    return [
      '预约审核通过',
      '预约审核拒绝',
      '预约审核超时',
      '规则复审超时',
      '取消申请已通过',
      '维护导致未来时段取消',
      '用户已取消未来时段',
      '规则复审未通过，未来时段已取消',
      '账号暂停导致未来时段取消',
      '课题停用导致未来时段取消',
      '账号注销导致未来时段取消',
    ].includes(item.title)
  })
  if (hasFinalTimeline || !booking.updatedAt || booking.updatedAt === booking.createdAt) return null

  const map = {
    cancelled: '预约已取消',
    maintenance_cancelled: '维护导致未来时段取消',
    rejected: '预约审核拒绝',
    review_timeout: '预约审核超时',
    rule_rejected: '规则复审未通过，未来时段已取消',
  }
  const title = map[booking.status]
  if (!title) return null
  return {
    createdAt: booking.updatedAt,
    title,
    detail: booking.status === 'cancelled' && booking.cancellationNote
      ? formatCancellationReason(booking.cancellationNote)
      : '',
  }
}

function buildTimeline(booking) {
  const events = [{
    createdAt: booking.createdAt,
    title: booking.bookingType === 'special' ? '提交预约申请' : '创建预约',
    detail: booking.remark ? `备注：${booking.remark}` : '',
  }]

  if (booking.status === 'cancel_pending' && booking.updatedAt) {
    events.push({
      createdAt: booking.updatedAt,
      title: '已提交取消申请',
      detail: booking.cancellationNote ? formatCancellationReason(booking.cancellationNote) : '',
    })
  }

  ;(booking.reviewLogs || []).forEach((log) => {
    events.push({
      createdAt: log.createdAt,
      title: getReviewActionText(log),
      detail: getReviewReasonText(log),
    })
  })

  events.push(...groupSegmentEvents(booking.segments || []))

  const fallbackEvent = buildFallbackStatusEvent(booking, events)
  if (fallbackEvent) {
    events.push(fallbackEvent)
  }

  return events
    .filter((item) => item.createdAt)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .map((item, index) => ({
      ...item,
      logKey: `${new Date(item.createdAt).getTime()}_${index}`,
      timeText: dateUtils.formatDateTime(item.createdAt),
    }))
}

Page({
  data: {
    bookingId: '',
    booking: null,
    modal: {
      visible: false,
      title: '',
      content: '',
      confirmText: '确认',
      confirmTone: 'primary',
      payload: {},
    },
  },

  onLoad(options) {
    this.setData({
      bookingId: options.bookingId || '',
    })
  },

  onShow() {
    if (this.data.bookingId) {
      this.loadBooking()
    }
  },

  async loadBooking() {
    try {
      const booking = await api.callFunction('getMyBookingDetail', { bookingId: this.data.bookingId })
      const status = getDisplayStatus(booking.status, booking.endAt)
      const sourceSegments = Array.isArray(booking.segments) && booking.segments.length > 0
        ? booking.segments
        : [{
          startAt: booking.startAt,
          endAt: booking.endAt,
          state: ['cancelled', 'maintenance_cancelled', 'rejected', 'review_timeout', 'rule_rejected'].includes(booking.status) ? 'cancelled' : 'active',
          cancelledAt: booking.updatedAt,
          cancelReasonCode: booking.cancellationNote || '',
        }]
      const segments = sourceSegments.map((item, index) => {
        const segmentStatus = getSegmentStatus(item)
        return {
          ...item,
          segmentKey: `${new Date(item.startAt).getTime()}_${index}`,
          timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
          segmentStatusText: segmentStatus.text,
          segmentStatusTone: segmentStatus.tone,
          segmentReasonText: segmentStatus.reasonText,
        }
      })
      const segmentGroups = groupSegmentsByDate(segments)
      const hasFutureActiveSegments = segments.some((item) => {
        return (item.state || 'active') === 'active' && new Date(item.startAt) > new Date()
      })
      this.setData({
        booking: {
          ...booking,
          timeText: `${dateUtils.formatDateTime(booking.startAt)} - ${dateUtils.formatDateTime(booking.endAt)}`,
          createdAtText: booking.createdAt ? dateUtils.formatDateTime(booking.createdAt) : '',
          statusText: status.text,
          statusTone: status.tone,
          ruleText: (booking.specialReasons || []).map((item) => SPECIAL_RULE_LABELS[item] || item).join('、') || '无',
          cancellationText: formatCancellationReason(booking.cancellationNote),
          segmentGroups,
          timeline: buildTimeline({
            ...booking,
            segments: sourceSegments,
          }),
          canCancel: ['confirmed', 'pending_review', 'rule_review_pending'].includes(booking.status) && hasFutureActiveSegments,
        },
      })
    } catch (err) {
      this.setData({ booking: null })
    }
  },

  cancelBooking() {
    if (!this.data.booking) return
    this.setData({
      modal: {
        visible: true,
        title: '取消预约',
        content: '开始前 12 小时内取消将进入管理员审核，审核通过前该时段仍会占用。',
        confirmText: '确认取消',
        confirmTone: 'danger',
        payload: { bookingId: this.data.bookingId },
      },
    })
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  async confirmModal(event) {
    const { bookingId } = event.detail.payload
    this.closeModal()
    try {
      const result = await api.callFunction('cancelBookingV2', {
        bookingId,
        reason: '用户主动取消',
      })
      wx.showToast({
        title: result && result.needReview ? '已提交取消审核' : '已取消预约',
        icon: 'success',
      })
      this.loadBooking()
    } catch (err) {
      api.showError(err)
    }
  },
})
