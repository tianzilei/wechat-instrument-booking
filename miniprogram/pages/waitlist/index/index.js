const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')
const { getBookingStatus } = require('../../../utils/status')

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
        return {
          ...item,
          timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
          statusText: status.text,
          statusTone: status.tone,
        }
      })
      this.setData({ items })
    } catch (err) {
      this.setData({ items: [] })
    }
  },

  async confirmWaitlist(event) {
    try {
      await api.callFunction('confirmWaitlistV2', {
        waitlistId: event.currentTarget.dataset.id,
        action: event.currentTarget.dataset.action,
      })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },
})
