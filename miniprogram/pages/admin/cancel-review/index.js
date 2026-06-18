const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')

Page({
  data: {
    cancelItems: [],
    ruleItems: [],
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
      const [cancelRes, bookingRes] = await Promise.all([
        api.callFunction('listCancelReviews'),
        api.callFunction('listBookingReviews'),
      ])
      const cancelItems = (cancelRes.items || []).map((item) => ({
        ...item,
        timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
      }))
      const ruleItems = (bookingRes.items || [])
        .filter((item) => item.status === 'rule_review_pending')
        .map((item) => ({
          ...item,
          timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
        }))
      this.setData({ cancelItems, ruleItems })
    } catch (err) {
      this.setData({ cancelItems: [], ruleItems: [] })
    }
  },

  review(event) {
    const { id, action } = event.currentTarget.dataset
    if (action === 'reject') {
      this.setData({
        modal: {
          visible: true,
          title: '拒绝取消申请',
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
      await api.callFunction('reviewCancelV2', { bookingId, action, reason })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },

  async approveRule(event) {
    const bookingId = event.currentTarget.dataset.id
    try {
      await api.callFunction('reviewBookingV2', { bookingId, action: 'approve', reason: '' })
      wx.showToast({ title: '已通过', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },

  rejectRule(event) {
    const bookingId = event.currentTarget.dataset.id
    wx.showModal({
      title: '拒绝复审',
      content: '将取消该预约的全部未来时段。',
      editable: true,
      placeholderText: '请输入拒绝原因',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.callFunction('reviewBookingV2', { bookingId, action: 'reject', reason: res.content || '' })
          wx.showToast({ title: '已拒绝', icon: 'success' })
          this.loadItems()
        } catch (err) {
          api.showError(err)
        }
      },
    })
  },
})
