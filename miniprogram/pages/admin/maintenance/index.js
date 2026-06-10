const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')

Page({
  data: {
    form: {
      startAt: '',
      endAt: '',
      reason: '',
    },
    items: [],
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
    this.loadItems()
  },

  onInput(event) {
    this.setData({
      [`form.${event.currentTarget.dataset.field}`]: event.detail.value,
    })
  },

  parseDate(value) {
    return new Date(value.replace(' ', 'T'))
  },

  async create() {
    const { form } = this.data
    if (!form.startAt || !form.endAt) {
      wx.showToast({ title: '请填写开始和结束时间', icon: 'none' })
      return
    }
    this.setData({
      modal: {
        visible: true,
        title: '确认维护',
        content: '若维护时间与已有预约冲突，系统将自动取消冲突预约并通知用户。',
        confirmText: '新增维护',
        confirmTone: 'danger',
        payload: { form: { ...form } },
      },
    })
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  async confirmModal(event) {
    const { form } = event.detail.payload
    this.closeModal()
    try {
      await api.callFunction('createMaintenance', {
        startAt: this.parseDate(form.startAt).toISOString(),
        endAt: this.parseDate(form.endAt).toISOString(),
        reason: form.reason,
      })
      wx.showToast({ title: '已新增', icon: 'success' })
      this.setData({ form: { startAt: '', endAt: '', reason: '' } })
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
      }))
      this.setData({ items })
    } catch (err) {
      this.setData({ items: [] })
    }
  },
})
