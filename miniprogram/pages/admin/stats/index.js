const api = require('../../../utils/api')

Page({
  data: {
    stats: {
      byMonth: [],
      byTimeType: { workingHours: 0, nonWorkingHours: 0 },
    },
  },

  onShow() {
    this.loadStats()
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
})
