const app = getApp()
const api = require('../../../utils/api')
const { getRegistrationStatus } = require('../../../utils/status')

Page({
  data: {
    loading: false,
    user: {},
    hasLogin: false,
    needsLegalAcceptance: false,
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
    const isLoggedIn = !!user._id
    const needsLegal = app.needsLegalAcceptance()
    const regStatus = user.registrationStatus || 'unsubmitted'
    this.setData({
      user,
      hasLogin: isLoggedIn,
      needsLegalAcceptance: needsLegal,
      statusText: status.text,
      statusTone: status.tone,
      showRegister: isLoggedIn && regStatus !== 'approved',
    })
  },

  async login() {
    this.setData({ loading: true })
    const result = await app.refreshSession()
    this.setData({ loading: false })
    if (!result.success) {
      wx.showToast({ title: result.error.message, icon: 'none' })
      return
    }
    this.applyUser()
  },

  async acceptLegal() {
    wx.showLoading({ title: '处理中' })
    try {
      await api.callFunction('acceptLegalDocuments')
      wx.hideLoading()
      app.globalData.needsLegalAcceptance = false
      wx.showToast({ title: '已确认', icon: 'success' })
      this.applyUser()
    } catch (err) {
      wx.hideLoading()
      api.showError(err)
    }
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/auth/register/index' })
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/legal/agreement/index' })
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/privacy/index' })
  },
})
