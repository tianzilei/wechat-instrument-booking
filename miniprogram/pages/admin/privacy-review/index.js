const api = require('../../../utils/api')

Page({
  data: {
    items: [],
  },

  onShow() { this.loadItems() },

  async loadItems() {
    try {
      const res = await api.callFunction('listPrivacyRequests')
      this.setData({ items: res.items || [] })
    } catch (err) { this.setData({ items: [] }) }
  },

  getTypeLabel(type) {
    const map = { query: '查询', correct: '更正', delete: '删除', withdraw_consent: '撤回同意', deactivate: '注销', complaint: '投诉' }
    return map[type] || type
  },

  openDetail(event) {
    const requestId = event.currentTarget.dataset.id
    if (!requestId) return
    wx.navigateTo({ url: `/pages/admin/privacy-request-detail/index?requestId=${requestId}` })
  },
})
