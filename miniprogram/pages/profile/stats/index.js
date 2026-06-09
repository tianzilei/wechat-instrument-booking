const api = require('../../../utils/api')

Page({
  data: {
    stats: {},
    trend: [],
  },

  onShow() {
    this.loadStats()
  },

  async loadStats() {
    try {
      const stats = await api.callFunction('getUserStats')
      const max = Math.max(...(stats.monthlyTrend || []).map((item) => item.hours), 1)
      const trend = (stats.monthlyTrend || []).map((item) => ({
        ...item,
        percent: Math.round((item.hours / max) * 100),
      }))
      this.setData({ stats, trend })
    } catch (err) {
      this.setData({ stats: {}, trend: [] })
    }
  },
})
