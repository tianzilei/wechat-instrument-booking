const api = require('../../../utils/api')

Page({
  data: {
    userItems: [],
    projectItems: [],
  },

  onShow() {
    this.loadItems()
  },

  async loadItems() {
    try {
      const [registrationRes, projectRes] = await Promise.all([
        api.callFunction('listRegistrationReviews'),
        api.callFunction('listProjectApplications', { status: 'pending' }),
      ])
      this.setData({
        userItems: registrationRes.items || [],
        projectItems: projectRes.items || [],
      })
    } catch (err) {
      this.setData({ userItems: [], projectItems: [] })
    }
  },

  openRegistrationDetail(event) {
    const applicationId = event.currentTarget.dataset.id
    if (!applicationId) return
    wx.navigateTo({ url: `/pages/admin/registration-detail/index?applicationId=${applicationId}` })
  },

  openProjectDetail(event) {
    const applicationId = event.currentTarget.dataset.id
    if (!applicationId) return
    wx.navigateTo({ url: `/pages/admin/project-application-detail/index?applicationId=${applicationId}` })
  },
})
