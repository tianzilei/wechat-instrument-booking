const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function getDefaultForm() {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  return {
    date: dateUtils.formatDate(now),
    startHour: now.getHours(),
    durationHours: 1,
    reason: '',
  }
}

Page({
  data: {
    form: {
      date: '',
      startHour: 9,
      durationHours: 1,
      reason: '',
    },
    hours: Array.from({ length: 24 }, (_, index) => ({
      value: index,
      label: `${pad(index)}:00`,
    })),
    durations: Array.from({ length: 12 }, (_, index) => ({
      value: index + 1,
      label: `${index + 1} 小时`,
    })),
    items: [],
    focusMaintenanceId: '',
    focusItem: null,
    modal: {
      visible: false,
      title: '',
      content: '',
      confirmText: '确认',
      confirmTone: 'primary',
      payload: {},
    },
  },

  onLoad(options) {
    this.setData({
      form: getDefaultForm(),
      focusMaintenanceId: options.maintenanceId || '',
    })
  },

  onShow() {
    if (!this.data.form.date) {
      this.setData({ form: getDefaultForm() })
    }
    this.loadItems()
  },

  onDateChange(event) {
    this.setData({ 'form.date': event.detail.value })
  },

  onHourChange(event) {
    const hour = this.data.hours[Number(event.detail.value)]
    this.setData({ 'form.startHour': hour.value })
  },

  onDurationChange(event) {
    const duration = this.data.durations[Number(event.detail.value)]
    this.setData({ 'form.durationHours': duration.value })
  },

  onReasonInput(event) {
    this.setData({ 'form.reason': event.detail.value })
  },

  buildRange(form) {
    const startAt = new Date(`${form.date}T00:00:00`)
    startAt.setHours(form.startHour, 0, 0, 0)
    const endAt = new Date(startAt.getTime() + (form.durationHours * 3600000))
    return { startAt, endAt }
  },

  async create() {
    const { form } = this.data
    if (!form.date) {
      wx.showToast({ title: '请选择维护日期', icon: 'none' })
      return
    }
    const range = this.buildRange(form)
    this.setData({
      'modal.visible': false,
    })
    wx.showLoading({ title: '计算中' })
    try {
      const preview = await api.callFunction('createMaintenance', {
        startAt: range.startAt.toISOString(),
        endAt: range.endAt.toISOString(),
        reason: form.reason,
        previewOnly: true,
      })
      wx.hideLoading()
      this.setData({
        modal: {
          visible: true,
          title: '确认维护',
          content: `起止时间：${dateUtils.formatDateTime(range.startAt)} - ${dateUtils.formatDateTime(range.endAt)}；总时长：${preview.durationHours} 小时；受影响预约：${preview.affectedBookingCount} 条；将取消未来有效预约。`,
          confirmText: '新增维护',
          confirmTone: 'danger',
          payload: {
            startAt: range.startAt.toISOString(),
            endAt: range.endAt.toISOString(),
            reason: form.reason,
          },
        },
      })
    } catch (err) {
      wx.hideLoading()
      api.showError(err)
    }
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  async confirmModal(event) {
    const { startAt, endAt, reason } = event.detail.payload
    this.closeModal()
    try {
      await api.callFunction('createMaintenance', {
        startAt,
        endAt,
        reason,
      })
      wx.showToast({ title: '已新增', icon: 'success' })
      this.setData({ form: getDefaultForm() })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },

  async loadItems() {
    try {
      const data = await api.callFunction('listMaintenanceSlots')
      const items = (data.items || []).map((item) => ({
        ...item,
        timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
        impactText: `受影响预约 ${item.cancelledBookingCount || 0} 条`,
      }))
      const focusItem = items.find((item) => item._id === this.data.focusMaintenanceId) || null
      this.setData({ items, focusItem })
    } catch (err) {
      this.setData({ items: [], focusItem: null })
    }
  },

  deleteItem(event) {
    const maintenanceId = event.currentTarget.dataset.id
    wx.showModal({
      title: '删除维护',
      content: '删除后将从维护列表移除，但不会恢复已被取消的预约。',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.callFunction('deleteMaintenance', { maintenanceId })
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadItems()
        } catch (err) {
          api.showError(err)
        }
      },
    })
  },
})
