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
        const isRejected = item.status === 'rejected' || item.status === 'rule_rejected'
        const isCancellationOutcome = item.status === 'cancelled' || item.status === 'maintenance_cancelled'
        return {
          ...item,
          timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
          statusText: status.text,
          statusTone: status.tone,
          detailLabel: isRejected ? '拒绝原因' : (isCancellationOutcome ? '取消说明' : '备注'),
          detailText: isRejected
            ? (item.reviewReason || '管理员未填写拒绝原因')
            : (isCancellationOutcome ? (item.cancellationNote || '无取消说明') : (item.remark || '无备注')),
          canCancel: item.status === 'confirmed' || item.status === 'pending_review' || item.status === 'rule_review_pending',
        }
      })
      this.setData({ bookings })
    } catch (err) {
      this.setData({ bookings: [] })
    }
  },

  openDetail(event) {
    const bookingId = event.currentTarget.dataset.id
    if (!bookingId) return
    wx.navigateTo({ url: `/pages/profile/booking-detail/index?bookingId=${bookingId}` })
  },
})
