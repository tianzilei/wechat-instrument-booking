const api = require('../../../utils/api')

Page({
  data: {
    settings: null,
    loading: false,
    form: { openStartHour: 9, openEndHour: 18, maxAdvanceDays: 7 },
    showForm: false,
  },

  onShow() { this.loadSettings() },

  async loadSettings() {
    try {
      const res = await api.callFunction('getSettings')
      this.setData({ settings: res, form: { openStartHour: res.openStartHour, openEndHour: res.openEndHour, maxAdvanceDays: res.maxAdvanceDays } })
    } catch (err) { this.setData({ settings: null }) }
  },

  showForm() { this.setData({ showForm: true }) },
  hideForm() { this.setData({ showForm: false }) },

  onHourInput(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: parseInt(e.detail.value) || 0 }) },
  onDaysInput(e) { this.setData({ 'form.maxAdvanceDays': parseInt(e.detail.value) || 7 }) },

  async toggleServiceMode() {
    const current = this.data.settings.serviceMode || 'normal'
    const newMode = current === 'normal' ? 'maintenance' : 'normal'
    wx.showModal({
      title: newMode === 'maintenance' ? '开启维护模式' : '关闭维护模式',
      content: newMode === 'maintenance' ? '将暂停全部预约操作' : '将恢复正常预约',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.callFunction('updateSettings', { serviceMode: newMode })
          wx.showToast({ title: '已更新', icon: 'success' })
          this.loadSettings()
        } catch (err) { api.showError(err) }
      },
    })
  },

  async saveHours() {
    const { openStartHour, openEndHour, maxAdvanceDays } = this.data.form
    if (openStartHour >= openEndHour) { wx.showToast({ title: '时间范围无效', icon: 'none' }); return }
    this.setData({ loading: true })
    try {
      await api.callFunction('updateSettings', { openStartHour, openEndHour, maxAdvanceDays })
      wx.showToast({ title: '已保存', icon: 'success' })
      this.hideForm()
      this.loadSettings()
    } catch (err) { api.showError(err) }
    this.setData({ loading: false })
  },

  async runMigration() {
    wx.showModal({
      title: '执行数据迁移', content: '将清除旧字段、匿名化历史记录。此操作不可逆！',
      confirmText: '执行', confirmColor: '#e53e3e',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '迁移中...' })
        try {
          const result = await api.callFunction('migrateData')
          wx.hideLoading()
          wx.showModal({ title: '迁移完成', content: JSON.stringify(result, null, 2), showCancel: false })
        } catch (err) { wx.hideLoading(); api.showError(err) }
      },
    })
  },
})
