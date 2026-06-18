const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')

Page({
  data: {
    cancelItems: [],
    ruleItems: [],
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

  openDetail(event) {
    const bookingId = event.currentTarget.dataset.id
    if (!bookingId) return
    wx.navigateTo({ url: `/pages/admin/booking-detail/index?bookingId=${bookingId}&mode=review` })
  },
})
