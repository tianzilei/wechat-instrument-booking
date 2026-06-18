const api = require('../../../utils/api')

Page({
  data: {
    items: [],
    showForm: false,
    editingId: '',
    formName: '',
    formAbbr: '',
    formReason: '',
    submitting: false,
  },

  onShow() { this.loadProjects() },

  async loadProjects() {
    try {
      const res = await api.callFunction('listProjects', { status: 'active' })
      this.setData({ items: res.items || [] })
    } catch (err) { this.setData({ items: [] }) }
  },

  showCreate() {
    this.setData({ showForm: true, editingId: '', formName: '', formAbbr: '', formReason: '' })
  },

  editProject(e) {
    const p = e.currentTarget.dataset.project
    this.setData({ showForm: true, editingId: p._id, formName: p.name, formAbbr: p.abbr, formReason: '' })
  },

  hideForm() { this.setData({ showForm: false }) },

  onNameInput(e) { this.setData({ formName: e.detail.value }) },
  onAbbrInput(e) { this.setData({ formAbbr: e.detail.value }) },
  onReasonInput(e) { this.setData({ formReason: e.detail.value }) },

  async submitForm() {
    const { formName, formAbbr, editingId } = this.data
    if (!formName.trim() || !formAbbr.trim()) {
      wx.showToast({ title: '请填写完整', icon: 'none' }); return
    }
    this.setData({ submitting: true })
    try {
      if (editingId) {
        await api.callFunction('updateProject', { projectId: editingId, name: formName.trim(), abbr: formAbbr.trim() })
      } else {
        await api.callFunction('createProject', { name: formName.trim(), abbr: formAbbr.trim() })
      }
      wx.showToast({ title: '已保存', icon: 'success' })
      this.hideForm()
      this.loadProjects()
    } catch (err) { api.showError(err) }
    this.setData({ submitting: false })
  },

  async deactivateProject(e) {
    const p = e.currentTarget.dataset.project
    const res = await new Promise((resolve) => wx.showModal({
      title: '停用课题', content: `确定停用"${p.name}"？将取消该课题全部未来预约。`,
      confirmText: '停用', confirmColor: '#A43B32', success: resolve,
    }))
    if (!res.confirm) return
    try {
      await api.callFunction('setProjectStatus', { projectId: p._id, action: 'inactive', reason: '管理员停用' })
      wx.showToast({ title: '已停用', icon: 'success' })
      this.loadProjects()
    } catch (err) { api.showError(err) }
  },
})
