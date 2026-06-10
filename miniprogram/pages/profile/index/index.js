const app = getApp()
const api = require('../../../utils/api')
const { getRegistrationStatus } = require('../../../utils/status')
const { setTabBarSelected } = require('../../../utils/tabbar')

Page({
  data: {
    user: null,
    statusText: '未登录',
    statusTone: 'muted',
    stats: {},
  },

  onShow() {
    setTabBarSelected(this, 1)
    this.applyUser()
    this.loadStats()
  },

  applyUser() {
    const user = app.globalData.user
    const status = getRegistrationStatus(user ? user.registrationStatus : 'unsubmitted')
    this.setData({
      user,
      statusText: user ? status.text : '未登录',
      statusTone: user ? status.tone : 'muted',
    })
  },

  async loadStats() {
    if (!app.globalData.user) return
    try {
      const stats = await api.callFunction('getUserStats')
      this.setData({ stats })
    } catch (err) {
      this.setData({ stats: {} })
    }
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/auth/login/index' })
  },

  goBookings() {
    wx.navigateTo({ url: '/pages/profile/bookings/index' })
  },

  goWaitlist() {
    wx.navigateTo({ url: '/pages/waitlist/index/index' })
  },

  goStats() {
    wx.navigateTo({ url: '/pages/profile/stats/index' })
  },
})
