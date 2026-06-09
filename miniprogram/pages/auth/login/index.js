const app = getApp()
const { getRegistrationStatus } = require('../../../utils/status')

Page({
  data: {
    loading: false,
    openid: '',
    user: {},
    statusText: '未登录',
    statusTone: 'muted',
    showRegister: false,
  },

  onShow() {
    this.applyUser()
  },

  applyUser() {
    const user = app.globalData.user || {}
    const status = getRegistrationStatus(user.registrationStatus || 'unsubmitted')
    this.setData({
      openid: app.globalData.openid,
      user,
      statusText: status.text,
      statusTone: status.tone,
      showRegister: user.registrationStatus !== 'approved',
    })
  },

  async login() {
    this.setData({ loading: true })
    const result = await app.refreshSession()
    this.setData({ loading: false })
    if (!result.success) {
      wx.showToast({
        title: result.error.message,
        icon: 'none',
      })
      return
    }
    this.applyUser()
  },

  goRegister() {
    wx.navigateTo({
      url: '/pages/auth/register/index',
    })
  },
})
