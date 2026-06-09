const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')
const { getBookingStatus } = require('../../../utils/status')

Page({
  data: {
    filters: [
      { label: '全部', value: 'all' },
      { label: '待开始', value: 'upcoming' },
      { label: '审核中', value: 'pending' },
      { label: '已取消', value: 'cancelled' },
    ],
    activeFilter: 'all',
    bookings: [],
  },

  onShow() {
    this.loadBookings()
  },

  changeFilter(event) {
    this.setData({ activeFilter: event.currentTarget.dataset.value })
    this.loadBookings()
  },

  async loadBookings() {
    try {
      const data = await api.callFunction('listMyBookings', {
        status: this.data.activeFilter,
      })
      const bookings = (data.items || []).map((item) => {
        const status = getBookingStatus(item.status)
        return {
          ...item,
          timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
          statusText: status.text,
          statusTone: status.tone,
          canCancel: item.status === 'confirmed' || item.status === 'pending_review',
        }
      })
      this.setData({ bookings })
    } catch (err) {
      this.setData({ bookings: [] })
    }
  },

  async cancelBooking(event) {
    const bookingId = event.currentTarget.dataset.id
    wx.showModal({
      title: '取消预约',
      content: '开始前 12 小时内取消将进入管理员审核。',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.callFunction('cancelBooking', {
            bookingId,
            reason: '用户主动取消',
          })
          wx.showToast({ title: '已提交', icon: 'success' })
          this.loadBookings()
        } catch (err) {
          api.showError(err)
        }
      },
    })
  },
})
