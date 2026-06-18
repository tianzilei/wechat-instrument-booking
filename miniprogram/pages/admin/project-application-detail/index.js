const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')

function getStatusMeta(status) {
  if (status === 'approved') return { text: '已通过', tone: 'success' }
  if (status === 'rejected') return { text: '已拒绝', tone: 'danger' }
  return { text: '待审核', tone: 'warning' }
}

Page({
  data: {
    applicationId: '',
    detail: null,
    finalName: '',
    finalAbbr: '',
    modal: {
      visible: false,
      title: '',
      content: '',
      showInput: false,
      placeholder: '',
      confirmText: '确认',
      confirmTone: 'primary',
      payload: {},
    },
  },

  onLoad(options) {
    this.setData({ applicationId: options.applicationId || '' })
  },

  onShow() {
    if (this.data.applicationId) this.loadDetail()
  },

  async loadDetail() {
    try {
      const detail = await api.callFunction('getProjectApplicationDetail', {
        applicationId: this.data.applicationId,
      })
      const status = getStatusMeta(detail.status)
      this.setData({
        detail: {
          ...detail,
          createdAtText: detail.createdAt ? dateUtils.formatDateTime(detail.createdAt) : '',
          statusText: status.text,
          statusTone: status.tone,
          canReview: detail.status === 'pending',
        },
        finalName: detail.finalName || detail.proposedName || '',
        finalAbbr: detail.finalAbbr || detail.proposedAbbr || '',
      })
    } catch (err) {
      this.setData({ detail: null })
    }
  },

  onFinalNameInput(event) {
    this.setData({ finalName: event.detail.value })
  },

  onFinalAbbrInput(event) {
    this.setData({ finalAbbr: event.detail.value })
  },

  approve() {
    const finalName = (this.data.finalName || '').trim()
    const finalAbbr = (this.data.finalAbbr || '').trim()
    if (!finalName || !finalAbbr) {
      wx.showToast({ title: '请填写最终课题名称和缩写', icon: 'none' })
      return
    }
    this.submitReview('approve', '', finalName, finalAbbr)
  },

  reject() {
    this.setData({
      modal: {
        visible: true,
        title: '拒绝课题申请',
        content: '请填写拒绝原因，申请人会在课题状态中看到该说明。',
        showInput: true,
        placeholder: '请输入拒绝原因',
        confirmText: '确认拒绝',
        confirmTone: 'danger',
        payload: { action: 'reject' },
      },
    })
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  confirmModal(event) {
    const reason = event.detail.value || ''
    if (!reason) {
      wx.showToast({ title: '请填写拒绝原因', icon: 'none' })
      return
    }
    this.closeModal()
    this.submitReview('reject', reason, '', '')
  },

  async submitReview(action, reason, finalName, finalAbbr) {
    try {
      const payload = {
        applicationId: this.data.applicationId,
        action,
        reason,
      }
      if (action === 'approve') {
        payload.finalName = finalName
        payload.finalAbbr = finalAbbr
      }
      await api.callFunction('reviewProjectApplication', payload)
      wx.showToast({ title: action === 'approve' ? '已通过课题申请' : '已拒绝课题申请', icon: 'success' })
      this.loadDetail()
    } catch (err) {
      api.showError(err)
    }
  },
})
