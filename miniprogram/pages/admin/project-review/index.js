const api = require('../../../utils/api')

Page({
  data: {
    items: [],
  },

  onShow() {
    this.loadItems()
  },

  async loadItems() {
    try {
      const projectRes = await api.callFunction('listProjectApplications', { status: 'pending' })
      this.setData({ items: projectRes.items || [] })
    } catch (err) {
      this.setData({ items: [] })
    }
  },

  openDetail(event) {
    const applicationId = event.currentTarget.dataset.id
    if (!applicationId) return
    wx.navigateTo({ url: `/pages/admin/project-application-detail/index?applicationId=${applicationId}` })
  },
})
