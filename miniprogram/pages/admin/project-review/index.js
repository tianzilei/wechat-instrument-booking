const api = require('../../../utils/api')

Page({
  data: {
    items: [],
    modal: {
      visible: false, title: '', showInput: true, placeholder: '',
      confirmText: '', confirmTone: 'primary', payload: {},
    },
  },

  onShow() { this.loadItems() },

  async loadItems() {
    try {
      const res = await api.callFunction('listProjectApplications', { status: 'pending' })
      this.setData({ items: res.items || [] })
    } catch (err) { this.setData({ items: [] }) }
  },

  approve(e) {
    const application = e.currentTarget.dataset.application
    wx.showModal({
      title: '通过课题申请',
      content: `将创建课题"${application.proposedName}"（${application.proposedAbbr}），并通知申请人确认。`,
      editable: true, placeholderText: '可修改课题名称',
      success: async (res) => {
        if (!res.confirm) return
        const finalName = res.content || application.proposedName
        try {
          await api.callFunction('reviewProjectApplication', {
            applicationId: application._id, action: 'approve',
            finalName, finalAbbr: application.proposedAbbr,
          })
          wx.showToast({ title: '已通过', icon: 'success' })
          this.loadItems()
        } catch (err) { api.showError(err) }
      },
    })
  },

  reject(e) {
    const application = e.currentTarget.dataset.application
    this.setData({ modal: {
      visible: true, title: '拒绝课题申请', showInput: true,
      placeholder: '请输入拒绝原因', confirmText: '拒绝', confirmTone: 'danger',
      payload: { id: application._id },
    }})
  },

  closeModal() { this.setData({ 'modal.visible': false }) },

  async confirmModal(e) {
    const { id } = e.detail.payload
    const reason = e.detail.value || ''
    this.closeModal()
    try {
      await api.callFunction('reviewProjectApplication', { applicationId: id, action: 'reject', reason })
      wx.showToast({ title: '已拒绝', icon: 'success' })
      this.loadItems()
    } catch (err) { api.showError(err) }
  },
})
