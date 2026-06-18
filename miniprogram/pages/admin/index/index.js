const app = getApp()
const api = require('../../../utils/api')
const { setTabBarSelected } = require('../../../utils/tabbar')

const TODO_CARD_DEFS = [
  { key: 'reviewPending', title: '注册用户/课题待审', desc: '统一处理注册审核与课题申请', url: '/pages/admin/user-review/index' },
  { key: 'bookingPending', title: '预约待审', desc: '处理非工作时间与周末预约', url: '/pages/admin/booking-review/index' },
  { key: 'cancelPending', title: '取消待审', desc: '统一处理取消申请与规则复审', url: '/pages/admin/cancel-review/index' },
  { key: 'privacyPending', title: '隐私请求', desc: '处理查询、更正、删除等请求', url: '/pages/admin/privacy-review/index' },
]

function buildTodoCards(dashboard) {
  return TODO_CARD_DEFS.map((item) => ({
    ...item,
    count: (dashboard && dashboard[item.key]) || 0,
  }))
}

function getTotalTodoCount(dashboard) {
  return TODO_CARD_DEFS.reduce((total, item) => total + ((dashboard && dashboard[item.key]) || 0), 0)
}

Page({
  data: {
    isAdmin: false,
    dashboard: {},
    todoCards: buildTodoCards(),
    totalTodoCount: 0,
    navs: [
      { title: '维护', desc: '创建和删除维护时间', url: '/pages/admin/maintenance/index' },
      { title: '设置', desc: '服务模式、统计与导出', url: '/pages/admin/maintenance-mode/index' },
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
      this.setData({
        dashboard,
        todoCards: buildTodoCards(dashboard),
        totalTodoCount: getTotalTodoCount(dashboard),
      })
    } catch (err) {
      this.setData({
        dashboard: {},
        todoCards: buildTodoCards(),
        totalTodoCount: 0,
      })
    }
  },

  goPage(event) {
    wx.navigateTo({
      url: event.currentTarget.dataset.url,
    })
  },
})
