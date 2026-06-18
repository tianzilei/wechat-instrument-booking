const app = getApp()
const api = require('../../../utils/api')
const { getRegistrationStatus } = require('../../../utils/status')
const { setTabBarSelected } = require('../../../utils/tabbar')

function buildPrimaryAction(user) {
  if (!user || user.role === 'admin' || user.registrationStatus === 'approved') {
    return { visible: false, text: '', mode: '' }
  }
  if (user.registrationStatus === 'project_confirm_required') {
    return { visible: true, text: '确认课题并完成注册', mode: 'confirm-project' }
  }
  if (['unsubmitted', 'rejected'].includes(user.registrationStatus || 'unsubmitted')) {
    return { visible: true, text: '提交注册申请', mode: 'register' }
  }
  return { visible: false, text: '', mode: '' }
}

Page({
  data: {
    user: null,
    statusText: '未登录',
    statusTone: 'muted',
    stats: {},
    showPrimaryAction: false,
    primaryActionText: '',
    primaryActionMode: '',
  },

  onShow() {
    setTabBarSelected(this, 1)
    this.applyUser()
    this.loadStats()
  },

  applyUser() {
    const user = app.globalData.user
    const status = getRegistrationStatus(user ? user.registrationStatus : 'unsubmitted')
    let statusText = user ? status.text : '未登录'
    let statusTone = user ? status.tone : 'muted'
    if (user && user.accountStatus === 'suspended') {
      statusText = '已暂停'
      statusTone = 'danger'
    } else if (user && user.accountStatus === 'deleting') {
      statusText = '注销处理中'
      statusTone = 'warning'
    } else if (user && user.accountStatus === 'project_reassignment_required') {
      statusText = '需重新选课题'
      statusTone = 'warning'
    }
    const action = buildPrimaryAction(user)
    this.setData({
      user,
      statusText,
      statusTone,
      showPrimaryAction: action.visible,
      primaryActionText: action.text,
      primaryActionMode: action.mode,
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

  goRegister() {
    wx.navigateTo({ url: '/pages/auth/register/index' })
  },

  async confirmProject() {
    wx.showLoading({ title: '处理中' })
    try {
      await api.callFunction('confirmApprovedProject')
      await app.refreshSession()
      wx.hideLoading()
      wx.showToast({ title: '已完成注册', icon: 'success' })
      this.applyUser()
      this.loadStats()
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

  goBookings() {
    wx.navigateTo({ url: '/pages/profile/bookings/index' })
  },

  goWaitlist() {
    wx.navigateTo({ url: '/pages/waitlist/index/index' })
  },

  goStats() {
    wx.navigateTo({ url: '/pages/profile/stats/index' })
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/legal/agreement/index' })
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/privacy/index' })
  },

  goPrivacyRequests() {
    wx.navigateTo({ url: '/pages/profile/privacy/index' })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后将以游客身份浏览，不影响已有预约记录。是否继续？',
      confirmText: '退出',
      confirmColor: '#A43B32',
      success: (res) => {
        if (res.confirm) {
          app.setUser(null)
          wx.showToast({ title: '已退出', icon: 'none' })
          setTimeout(() => wx.switchTab({ url: '/pages/calendar/index' }), 500)
        }
      },
    })
  },

  deleteAccount() {
    wx.showModal({
      title: '注销账号',
      content: '注销后将不可撤销：\n\n1. 取消全部未来预约和候补\n2. 删除个人资料和协议记录\n3. 历史预约将被匿名化处理\n\n是否继续？',
      confirmText: '确认注销',
      confirmColor: '#A43B32',
      success: (res) => {
        if (!res.confirm) return
        wx.showModal({
          title: '二次确认',
          content: '注销后无法恢复，确认删除账号吗？',
          confirmText: '删除',
          confirmColor: '#A43B32',
          success: async (res2) => {
            if (!res2.confirm) return
            wx.showLoading({ title: '注销中...' })
            try {
              await api.callFunction('deleteAccount')
              wx.hideLoading()
              app.setUser(null)
              wx.showToast({ title: '已提交注销', icon: 'none' })
              setTimeout(() => wx.switchTab({ url: '/pages/calendar/index' }), 800)
            } catch (err) {
              wx.hideLoading()
              api.showError(err)
            }
          },
        })
      },
    })
  },
})
