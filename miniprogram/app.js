const config = require('./config')

App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showToast({
        title: '当前基础库不支持云开发',
        icon: 'none',
      })
      return
    }

    wx.cloud.init({
      env: config.envId,
      traceUser: true,
    })

    this.refreshSession()
  },

  async refreshSession() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: {},
      })
      const result = res.result || {}
      if (result.success && result.data && result.data.identified) {
        this.globalData.user = result.data.user
        this.globalData.hasLogin = true
        this.globalData.needsLegalAcceptance = result.data.needsLegalAcceptance || false
      } else {
        this.globalData.user = null
        this.globalData.hasLogin = false
        this.globalData.needsLegalAcceptance = false
      }
      return result
    } catch (err) {
      this.globalData.hasLogin = false
      return {
        success: false,
        error: {
          code: 'LOGIN_FAILED',
          message: '登录失败，请稍后重试',
        },
      }
    }
  },

  setUser(user) {
    this.globalData.user = user
    this.globalData.hasLogin = !!user
    if (!user) {
      this.globalData.needsLegalAcceptance = false
    }
  },

  isAdmin() {
    const { user } = this.globalData
    return user && user.role === 'admin'
  },

  isApprovedUser() {
    const { user } = this.globalData
    if (!user) return false
    if (user.accountStatus && user.accountStatus !== 'active') return false
    return user.registrationStatus === 'approved'
  },

  needsLegalAcceptance() {
    return this.globalData.needsLegalAcceptance
  },

  globalData: {
    hasLogin: false,
    needsLegalAcceptance: false,
    user: null,
  },
})
