const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')
const { getBookingStatus } = require('../../../utils/status')

const SPECIAL_RULE_LABELS = {
  night: '非工作时间',
  weekend: '周末',
}

Page({
  data: {
    bookingId: '',
    booking: null,
    reviewMode: false,
    modal: {
      visible: false,
      title: '',
      content: '',
      showInput: false,
      placeholder: '',
      confirmText: '确认',
      confirmTone: 'primary',
      payload: {},
    },
  },

  onLoad(options) {
    this.setData({
      bookingId: options.bookingId || '',
      reviewMode: options.mode === 'review',
    })
  },

  onShow() {
    if (this.data.bookingId) {
      this.loadBooking()
    }
  },

  async loadBooking() {
    try {
      const booking = await api.callFunction('getAdminBookingDetail', { bookingId: this.data.bookingId })
      const status = getBookingStatus(booking.status)
      const segments = (booking.segments || []).map((item) => ({
        ...item,
        timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
        cancelled: (item.state || 'active') === 'cancelled',
      }))
      this.setData({
        booking: {
          ...booking,
          timeText: `${dateUtils.formatDateTime(booking.startAt)} - ${dateUtils.formatDateTime(booking.endAt)}`,
          statusText: status.text,
          statusTone: status.tone,
          ruleText: (booking.specialReasons || []).map((item) => SPECIAL_RULE_LABELS[item] || item).join('、') || '无',
          segments,
        },
      })
    } catch (err) {
      this.setData({ booking: null })
    }
  },

  review(event) {
    const action = event.currentTarget.dataset.action
    if (action === 'reject') {
      this.setData({
        modal: {
          visible: true,
          title: '拒绝预约申请',
          content: '请填写拒绝原因，用户会在预约记录中看到该说明。',
          showInput: true,
          placeholder: '请输入拒绝原因',
          confirmText: '拒绝',
          confirmTone: 'danger',
          payload: { action },
        },
      })
      return
    }
    this.submitReview(action, '')
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  confirmModal(event) {
    const reason = event.detail.value || ''
    if (!reason) {
      wx.showToast({ title: '请填写拒绝原因', icon: 'none' })
      return
    }
    this.closeModal()
    this.submitReview('reject', reason)
  },

  async submitReview(action, reason) {
    try {
      await api.callFunction('reviewBookingV2', {
        bookingId: this.data.bookingId,
        action,
        reason,
      })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadBooking()
    } catch (err) {
      api.showError(err)
    }
  },
})
