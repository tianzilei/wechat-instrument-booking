const api = require('../../../utils/api')

Page({
  data: {
    settings: null,
    stats: {
      byMonth: [],
      byTimeType: { workingHours: 0, nonWorkingHours: 0 },
    },
    loading: false,
    exporting: false,
    form: { openStartHour: 9, openEndHour: 18, maxAdvanceDays: 7 },
    showForm: false,
  },

  onShow() {
    this.loadSettings()
    this.loadStats()
  },

  async loadSettings() {
    try {
      const res = await api.callFunction('getSettings')
      this.setData({ settings: res, form: { openStartHour: res.openStartHour, openEndHour: res.openEndHour, maxAdvanceDays: res.maxAdvanceDays } })
    } catch (err) { this.setData({ settings: null }) }
  },

  async loadStats() {
    try {
      const stats = await api.callFunction('getAdminStats')
      this.setData({
        stats: {
          byMonth: [],
          byTimeType: { workingHours: 0, nonWorkingHours: 0 },
          ...stats,
        },
      })
    } catch (err) {
      this.setData({
        stats: {
          byMonth: [],
          byTimeType: { workingHours: 0, nonWorkingHours: 0 },
        },
      })
    }
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

  async exportData() {
    if (this.data.exporting) return
    wx.showModal({
      title: '导出运营数据',
      content: '该导出仅限管理员内部使用，包含课题与预约人信息，不包含 openid、备注、隐私请求和审核日志。确认继续导出吗？',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ exporting: true })
        wx.showLoading({ title: '正在导出' })
        try {
          const result = await api.callFunction('exportOperationalData')
          const download = await new Promise((resolve, reject) => {
            wx.cloud.downloadFile({
              fileID: result.fileId,
              success: resolve,
              fail: reject,
            })
          })
          wx.hideLoading()
          if (typeof wx.shareFileMessage === 'function') {
            wx.shareFileMessage({
              filePath: download.tempFilePath,
              fileName: result.fileName,
              fail: () => wx.setClipboardData({ data: result.tempFileURL }),
            })
          } else {
            wx.setClipboardData({ data: result.tempFileURL })
          }
        } catch (err) {
          wx.hideLoading()
          api.showError(err)
        } finally {
          this.setData({ exporting: false })
        }
      },
    })
  },
})
