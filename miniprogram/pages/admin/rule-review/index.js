const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')

Page({
  data: {
    items: [],
  },

  onShow() {
    this.loadItems()
  },

  async loadItems() {
    try {
      const bookingRes = await api.callFunction('listBookingReviews')
      const items = (bookingRes.items || [])
        .filter((item) => item.status === 'rule_review_pending')
        .map((item) => ({
          ...item,
          timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
        }))
      this.setData({ items })
    } catch (err) {
      this.setData({ items: [] })
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
