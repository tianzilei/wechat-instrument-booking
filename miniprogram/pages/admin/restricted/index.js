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
    try {
      await api.callFunction('createRestrictedSlot', {
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
      const data = await api.callFunction('listRestrictedSlots')
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
