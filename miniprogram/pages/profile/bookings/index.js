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
    modal: {
      visible: false,
      title: '',
      content: '',
      confirmText: '确认',
      confirmTone: 'primary',
      payload: {},
    },
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
        const isRejected = item.status === 'rejected'
        return {
          ...item,
          timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
          statusText: status.text,
          statusTone: status.tone,
          detailLabel: isRejected ? '拒绝原因' : '备注',
          detailText: isRejected ? (item.reviewReason || '管理员未填写拒绝原因') : (item.remark || '无备注'),
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
    this.setData({
      modal: {
        visible: true,
        title: '取消预约',
        content: '开始前 12 小时内取消将进入管理员审核，审核通过前该时段仍会占用。',
        confirmText: '确认取消',
        confirmTone: 'danger',
        payload: { bookingId },
      },
    })
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  async confirmModal(event) {
    const { bookingId } = event.detail.payload
    this.closeModal()
    try {
      await api.callFunction('cancelBookingV2', { bookingId, reason: '用户主动取消' })
      wx.showToast({ title: '已提交', icon: 'success' })
      this.loadBookings()
    } catch (err) {
      api.showError(err)
    }
  },
})
