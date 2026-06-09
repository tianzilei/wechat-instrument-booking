const api = require('../../../utils/api')

Page({
  data: {
    stats: {
      byUser: [],
      byMonth: [],
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
          byUser: [],
          byMonth: [],
          ...stats,
        },
      })
    } catch (err) {
      this.setData({ stats: { byUser: [], byMonth: [] } })
    }
  },
})
