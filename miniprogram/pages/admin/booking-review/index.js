const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')

const SPECIAL_RULE_LABELS = {
  night: '非工作时间',
  weekend: '周末',
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

  openDetail(event) {
    const bookingId = event.currentTarget.dataset.id
    if (!bookingId) return
    wx.navigateTo({ url: `/pages/admin/booking-detail/index?bookingId=${bookingId}&mode=review` })
  },
})
