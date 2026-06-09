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
      const data = await api.callFunction('listBookingReviews')
      const items = (data.items || []).map((item) => ({
        ...item,
        timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
        reasonText: (item.specialReasons || []).join('、') || '特殊时段',
      }))
      this.setData({ items })
    } catch (err) {
      this.setData({ items: [] })
    }
  },

  review(event) {
    const { id, action } = event.currentTarget.dataset
    if (action === 'reject') {
      wx.showModal({
        title: '拒绝原因',
        editable: true,
        placeholderText: '请输入拒绝原因',
        success: (res) => {
          if (res.confirm) this.submitReview(id, action, res.content || '')
        },
      })
      return
    }
    this.submitReview(id, action, '')
  },

  async submitReview(bookingId, action, reason) {
    try {
      await api.callFunction('reviewBooking', { bookingId, action, reason })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },
})
