const api = require('../../../utils/api')

Page({
  data: {
    items: [],
    modal: { visible: false, requestId: '', title: '', action: '' },
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

  processing(e) {
    this.setData({ modal: { visible: true, requestId: e.currentTarget.dataset.id, title: '标记处理中', action: 'processing' }})
  },

  complete(e) {
    this.setData({ modal: { visible: true, requestId: e.currentTarget.dataset.id, title: '完成请求', action: 'complete' }})
  },

  reject(e) {
    this.setData({ modal: { visible: true, requestId: e.currentTarget.dataset.id, title: '拒绝请求', action: 'reject' }})
  },

  closeModal() { this.setData({ 'modal.visible': false }) },

  async confirmModal(e) {
    const { requestId, action } = this.data.modal
    const note = e.detail.value || ''
    this.closeModal()
    try {
      await api.callFunction('processPrivacyRequest', { requestId, action, note })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) { api.showError(err) }
  },
})
