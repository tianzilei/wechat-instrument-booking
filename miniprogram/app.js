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
      if (result.success) {
        this.globalData.openid = result.data.openid
        this.globalData.user = result.data.user
        this.globalData.hasLogin = true
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
  },

  isAdmin() {
    const { user } = this.globalData
    return user && user.role === 'admin'
  },

  isApprovedUser() {
    const { user } = this.globalData
    return user && user.registrationStatus === 'approved'
  },

  globalData: {
    hasLogin: false,
    openid: '',
    user: null,
  },
})
