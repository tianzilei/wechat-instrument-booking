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
      const data = await api.callFunction('listCancelReviews')
      const items = (data.items || []).map((item) => ({
        ...item,
        timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
      }))
      this.setData({ items })
    } catch (err) {
      this.setData({ items: [] })
    }
  },

  async review(event) {
    const { id, action } = event.currentTarget.dataset
    try {
      await api.callFunction('reviewCancelV2', { bookingId: id, action, reason: '' })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },
})
