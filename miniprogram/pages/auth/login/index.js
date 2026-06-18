const app = getApp()
const api = require('../../../utils/api')
const { getRegistrationStatus } = require('../../../utils/status')

function buildPrimaryAction(user, isLoggedIn) {
  if (!isLoggedIn) {
    return { visible: true, text: '提交注册申请', mode: 'register' }
  }
  if (!user || user.role === 'admin') {
    return { visible: false, text: '', mode: '' }
  }

  const status = user.registrationStatus || 'unsubmitted'
  if (status === 'project_confirm_required') {
    return { visible: true, text: '确认课题并完成注册', mode: 'confirm-project' }
  }
  if (['unsubmitted', 'rejected'].includes(status)) {
    return { visible: true, text: '提交注册申请', mode: 'register' }
  }
  return { visible: false, text: '', mode: '' }
}

Page({
  data: {
    loading: false,
    user: {},
    hasLogin: false,
    needsLegalAcceptance: false,
    statusText: '未登录',
    statusTone: 'muted',
    showPrimaryAction: false,
    primaryActionText: '',
    primaryActionMode: '',
  },

  onShow() {
    this.applyUser()
  },

  applyUser() {
    const user = app.globalData.user || {}
    const status = getRegistrationStatus(user.registrationStatus || 'unsubmitted')
    const isLoggedIn = !!user._id
    const needsLegal = app.needsLegalAcceptance()
    const action = buildPrimaryAction(user, isLoggedIn)
    this.setData({
      user,
      hasLogin: isLoggedIn,
      needsLegalAcceptance: needsLegal,
      statusText: status.text,
      statusTone: status.tone,
      showPrimaryAction: action.visible,
      primaryActionText: action.text,
      primaryActionMode: action.mode,
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
      const res = await api.callFunction('acceptLegalDocuments')
      wx.hideLoading()
      app.globalData.needsLegalAcceptance = false
      const user = app.globalData.user || {}
      user.agreementVersion = res.agreementVersion || ''
      user.privacyVersion = res.privacyVersion || ''
      app.globalData.user = user
      wx.showToast({ title: '已确认', icon: 'success' })
      this.applyUser()
    } catch (err) {
      wx.hideLoading()
      api.showError(err)
    }
  },

  async confirmProject() {
    wx.showLoading({ title: '处理中' })
    try {
      await api.callFunction('confirmApprovedProject')
      await app.refreshSession()
      wx.hideLoading()
      wx.showToast({ title: '已完成注册', icon: 'success' })
      this.applyUser()
    } catch (err) {
      wx.hideLoading()
      api.showError(err)
    }
  },

  handlePrimaryAction() {
    if (this.data.primaryActionMode === 'confirm-project') {
      this.confirmProject()
      return
    }
    this.goRegister()
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
