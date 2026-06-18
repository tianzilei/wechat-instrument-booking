const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')

function getTypeLabel(type) {
  const map = {
    query: '查询',
    correct: '更正',
    delete: '删除',
    withdraw_consent: '撤回同意',
    deactivate: '注销',
    complaint: '投诉',
  }
  return map[type] || type || '未知'
}

function getStatusMeta(status) {
  if (status === 'processing') return { text: '处理中', tone: 'accent' }
  if (status === 'completed') return { text: '已完成', tone: 'success' }
  if (status === 'rejected') return { text: '已拒绝', tone: 'danger' }
  return { text: '待处理', tone: 'warning' }
}

Page({
  data: {
    requestId: '',
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
    this.setData({ requestId: options.requestId || '' })
  },

  onShow() {
    if (this.data.requestId) this.loadDetail()
  },

  async loadDetail() {
    try {
      const detail = await api.callFunction('getPrivacyRequestDetail', {
        requestId: this.data.requestId,
      })
      const status = getStatusMeta(detail.status)
      this.setData({
        detail: {
          ...detail,
          typeText: getTypeLabel(detail.type),
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

  openAction(event) {
    const action = event.currentTarget.dataset.action
    const map = {
      processing: { title: '标记处理中', confirmText: '确认处理中', confirmTone: 'primary' },
      complete: { title: '完成请求', confirmText: '确认完成', confirmTone: 'primary' },
      reject: { title: '拒绝请求', confirmText: '确认拒绝', confirmTone: 'danger' },
    }
    const meta = map[action]
    if (!meta) return
    this.setData({
      modal: {
        visible: true,
        title: meta.title,
        content: '请填写处理说明，用户会在请求记录中看到该说明。',
        showInput: true,
        placeholder: '请输入处理说明',
        confirmText: meta.confirmText,
        confirmTone: meta.confirmTone,
        payload: { action },
      },
    })
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  confirmModal(event) {
    const note = event.detail.value || ''
    this.closeModal()
    this.submitAction(this.data.modal.payload.action, note)
  },

  async submitAction(action, note) {
    try {
      await api.callFunction('processPrivacyRequest', {
        requestId: this.data.requestId,
        action,
        note,
      })
      const toastMap = {
        processing: '已标记处理中',
        complete: '已完成请求',
        reject: '已拒绝请求',
      }
      wx.showToast({ title: toastMap[action] || '已处理', icon: 'success' })
      this.loadDetail()
    } catch (err) {
      api.showError(err)
    }
  },
})
