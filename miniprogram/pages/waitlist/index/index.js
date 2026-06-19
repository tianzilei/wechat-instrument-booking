const app = getApp()
const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')
const { getBookingStatus } = require('../../../utils/status')

function getWaitlistSegments(item) {
  const source = item.segments || item.occupiedSegments || []
  if (source.length > 0) return source
  if (item.startAt && item.endAt) {
    return [{ startAt: item.startAt, endAt: item.endAt }]
  }
  return []
}

function formatSegmentText(segment) {
  const startDate = dateUtils.formatDate(segment.startAt)
  const endDate = dateUtils.formatDate(segment.endAt)
  const startTime = dateUtils.formatTime(segment.startAt)
  const endTime = dateUtils.formatTime(segment.endAt)
  if (startDate === endDate) {
    return `${startDate} ${startTime} - ${endTime}`
  }
  return `${dateUtils.formatDateTime(segment.startAt)} - ${dateUtils.formatDateTime(segment.endAt)}`
}

Page({
  data: {
    items: [],
  },

  onShow() {
    this.loadItems()
  },

  async loadItems() {
    try {
      const data = await api.callFunction('listMyWaitlists')
      const items = (data.items || []).map((item) => {
        const statusKeyMap = {
          waitlisted: 'waitlisted',
          confirming: 'waitlist_confirming',
          expired: 'waitlist_expired',
          cancelled: 'waitlist_cancelled',
          converted: 'waitlist_converted',
        }
        const status = getBookingStatus(statusKeyMap[item.status] || 'waitlisted')
        const segmentTexts = getWaitlistSegments(item).map(formatSegmentText)
        return {
          ...item,
          timeText: segmentTexts.length > 1
            ? `共 ${segmentTexts.length} 段时段`
            : (segmentTexts[0] || `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`),
          segmentTexts,
          statusText: status.text,
          statusTone: status.tone,
          deadlineText: item.status === 'confirming' && item.confirmDeadlineAt
            ? dateUtils.formatDateTime(item.confirmDeadlineAt)
            : '',
          convertedHint: item.status === 'converted' && item.convertedBookingId
            ? '已转为预约，请到“我的预约”查看后续状态。'
            : '',
        }
      })
      this.setData({ items })
    } catch (err) {
      this.setData({ items: [] })
    }
  },

  async confirmWaitlist(event) {
    if (app.needsLegalAcceptance()) {
      wx.showToast({ title: '请先同意最新协议', icon: 'none' })
      wx.navigateTo({ url: '/pages/auth/login/index' })
      return
    }
    try {
      const action = event.currentTarget.dataset.action
      const result = await api.callFunction('confirmWaitlistV2', {
        waitlistId: event.currentTarget.dataset.id,
        action,
      })
      let toastTitle = '已处理'
      if (action === 'decline') {
        toastTitle = '已放弃候补'
      } else if (result && result.status === 'converted') {
        toastTitle = result.duplicateRequest ? '候补已转为预约' : '已转为预约'
      }
      wx.showToast({ title: toastTitle, icon: 'success' })
      this.loadItems()
    } catch (err) {
      if (err && err.code === 'LEGAL_ACCEPTANCE_REQUIRED') {
        app.globalData.needsLegalAcceptance = true
        wx.showToast({ title: '请先同意最新协议', icon: 'none' })
        wx.navigateTo({ url: '/pages/auth/login/index' })
        return
      }
      if (err && err.code === 'STATE_CHANGED') {
        wx.showToast({ title: err.message || '状态已变化，请刷新后重试', icon: 'none' })
        this.loadItems()
        return
      }
      api.showError(err)
    }
  },
})
