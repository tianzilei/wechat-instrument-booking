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

  openDetail(event) {
    const bookingId = event.currentTarget.dataset.id
    if (!bookingId) return
    wx.navigateTo({ url: `/pages/admin/booking-detail/index?bookingId=${bookingId}&mode=review` })
  },
})
