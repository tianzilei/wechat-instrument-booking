const app = getApp()
const api = require('../../../utils/api')
const { setTabBarSelected } = require('../../../utils/tabbar')

Page({
  data: {
    isAdmin: false,
    dashboard: {},
    navs: [
      { title: '注册审核', desc: '处理新用户注册申请', url: '/pages/admin/user-review/index' },
      { title: '预约审核', desc: '处理特殊时段预约', url: '/pages/admin/booking-review/index' },
      { title: '取消审核', desc: '处理 12 小时内取消申请', url: '/pages/admin/cancel-review/index' },
      { title: '课题申请审核', desc: '处理新课题申请', url: '/pages/admin/project-review/index' },
      { title: '规则复审', desc: '处理规则变更触发的复审', url: '/pages/admin/rule-review/index' },
      { title: '隐私请求', desc: '处理用户隐私相关请求', url: '/pages/admin/privacy-review/index' },
      { title: '课题管理', desc: '管理正式课题目录', url: '/pages/admin/projects/index' },
      { title: '用户管理', desc: '查看用户与预约情况', url: '/pages/admin/users/index' },
      { title: '维护时间', desc: '设置绝对不可预约时段', url: '/pages/admin/maintenance/index' },
      { title: '受限时段', desc: '设置需要审核的单次时段', url: '/pages/admin/restricted/index' },
      { title: '使用统计', desc: '查看月份和时间类型统计', url: '/pages/admin/stats/index' },
      { title: '系统设置', desc: '服务模式、工作时间、数据导出', url: '/pages/admin/maintenance-mode/index' },
    ],
  },

  onShow() {
    setTabBarSelected(this, 2)
    this.setData({ isAdmin: app.isAdmin() })
    if (app.isAdmin()) this.loadDashboard()
  },

  async loadDashboard() {
    try {
      const dashboard = await api.callFunction('getAdminDashboard')
      this.setData({ dashboard })
    } catch (err) {
      this.setData({ dashboard: {} })
    }
  },

  goPage(event) {
    wx.navigateTo({
      url: event.currentTarget.dataset.url,
    })
  },
})
