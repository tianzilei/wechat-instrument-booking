const config = require('./config')
const api = require('./utils/api')
const { normalizeRegistrationStatus } = require('./utils/status')

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
    if (this.sessionRefreshPromise) return this.sessionRefreshPromise

    this.sessionRefreshPromise = api.callFunctionRaw('login').then((result) => {
      if (result.success && result.data && result.data.identified) {
        const user = result.data.user || null
        if (user) {
          user.registrationStatus = normalizeRegistrationStatus(user.registrationStatus)
        }
        this.globalData.user = user
        this.globalData.hasLogin = true
        this.globalData.needsLegalAcceptance = result.data.needsLegalAcceptance || false
      } else {
        this.globalData.user = null
        this.globalData.hasLogin = false
        this.globalData.needsLegalAcceptance = false
      }
      this.lastSessionResult = result
      return result
    }).catch(() => {
      const result = {
        success: false,
        error: {
          code: 'LOGIN_FAILED',
          message: '登录失败，请稍后重试',
        },
      }
        this.globalData.user = null
        this.globalData.hasLogin = false
        this.globalData.needsLegalAcceptance = false
      this.lastSessionResult = result
      return result
    }).finally(() => {
      this.globalData.sessionReady = true
      this.sessionRefreshPromise = null
    })

    return this.sessionRefreshPromise
  },

  ensureSessionReady() {
    if (this.sessionRefreshPromise) return this.sessionRefreshPromise
    if (this.globalData.sessionReady && this.lastSessionResult && this.lastSessionResult.success === false) {
      return this.refreshSession()
    }
    if (this.globalData.sessionReady) return Promise.resolve(this.lastSessionResult || { success: true, data: null, error: null })
    return this.refreshSession()
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
    sessionReady: false,
    user: null,
  },

  sessionRefreshPromise: null,
  lastSessionResult: null,
})
