const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')
const { getRegistrationStatus } = require('../../../utils/status')

Page({
  data: {
    applicationId: '',
    detail: null,
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
      const detail = await api.callFunction('getRegistrationReviewDetail', {
        applicationId: this.data.applicationId,
      })
      const status = getRegistrationStatus(detail.status)
      this.setData({
        detail: {
          ...detail,
          createdAtText: detail.createdAt ? dateUtils.formatDateTime(detail.createdAt) : '',
          statusText: status.text,
          statusTone: status.tone,
          canReview: detail.status === 'pending',
        },
      })
    } catch (err) {
      this.setData({ detail: null })
    }
  },

  approve() {
    this.submitReview('approve', '')
  },

  reject() {
    this.setData({
      modal: {
        visible: true,
        title: '拒绝注册申请',
        content: '请填写拒绝原因，用户会在注册状态中看到该说明。',
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
    this.submitReview('reject', reason)
  },

  async submitReview(action, reason) {
    try {
      await api.callFunction('reviewRegistrationV2', {
        applicationId: this.data.applicationId,
        action,
        reason,
      })
      wx.showToast({ title: action === 'approve' ? '已通过注册' : '已拒绝注册', icon: 'success' })
      this.loadDetail()
    } catch (err) {
      api.showError(err)
    }
  },
})
