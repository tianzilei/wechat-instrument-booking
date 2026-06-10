const api = require('../../../utils/api')

const TYPE_OPTIONS = [
  { value: 'query', label: '查询我的资料' },
  { value: 'correct', label: '更正姓名' },
  { value: 'delete', label: '删除数据' },
  { value: 'withdraw_consent', label: '撤回同意' },
  { value: 'deactivate', label: '注销账号' },
  { value: 'complaint', label: '投诉建议' },
]

Page({
  data: {
    items: [],
    showForm: false,
    selectedType: '',
    note: '',
    submitting: false,
    typeOptions: TYPE_OPTIONS,
  },

  onShow() {
    this.loadRequests()
  },

  async loadRequests() {
    try {
      const res = await api.callFunction('listMyPrivacyRequests')
      this.setData({ items: res.items || [] })
    } catch (err) {
      this.setData({ items: [] })
    }
  },

  showSubmitForm() {
    this.setData({ showForm: true, selectedType: '', note: '' })
  },

  hideForm() {
    this.setData({ showForm: false })
  },

  selectType(event) {
    this.setData({ selectedType: event.currentTarget.dataset.type })
  },

  onNoteInput(event) {
    this.setData({ note: event.detail.value })
  },

  getTypeLabel(value) {
    const opt = TYPE_OPTIONS.find((o) => o.value === value)
    return opt ? opt.label : value
  },

  getStatusLabel(status) {
    const map = { pending: '处理中', processing: '处理中', completed: '已完成', rejected: '已拒绝' }
    return map[status] || status
  },

  async submitRequest() {
    if (!this.data.selectedType) {
      wx.showToast({ title: '请选择请求类型', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await api.callFunction('submitPrivacyRequest', {
        type: this.data.selectedType,
        note: this.data.note.trim(),
      })
      wx.showToast({ title: '已提交', icon: 'success' })
      this.hideForm()
      this.loadRequests()
    } catch (err) {
      api.showError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },
})
