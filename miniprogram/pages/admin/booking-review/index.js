const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')

const SPECIAL_RULE_LABELS = {
  night: '非工作时间',
  weekend: '周末',
}

Page({
  data: {
    items: [],
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

  onShow() {
    this.loadItems()
  },

  async loadItems() {
    try {
      const data = await api.callFunction('listBookingReviews')
      const items = (data.items || [])
        .filter((item) => item.status === 'pending_review')
        .map((item) => ({
        ...item,
        timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
        ruleText: (item.specialReasons || []).map((reason) => SPECIAL_RULE_LABELS[reason] || reason).join('、') || '特殊审核规则',
      }))
      this.setData({ items })
    } catch (err) {
      this.setData({ items: [] })
    }
  },

  review(event) {
    const { id, action } = event.currentTarget.dataset
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
          payload: { id, action },
        },
      })
      return
    }
    this.submitReview(id, action, '')
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  confirmModal(event) {
    const { id, action } = event.detail.payload
    const reason = event.detail.value || ''
    if (!reason) {
      wx.showToast({ title: '请填写拒绝原因', icon: 'none' })
      return
    }
    this.closeModal()
    this.submitReview(id, action, reason)
  },

  async submitReview(bookingId, action, reason) {
    try {
      await api.callFunction('reviewBookingV2', { bookingId, action, reason })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },
})
