const api = require('../../../utils/api')

Page({
  data: {
    items: [],
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

  onShow() {
    this.loadItems()
  },

  async loadItems() {
    try {
      const data = await api.callFunction('listRegistrationReviews')
      this.setData({ items: data.items || [] })
    } catch (err) {
      this.setData({ items: [] })
    }
  },

  review(event) {
    const { id, action } = event.currentTarget.dataset
    if (action === 'reject') {
      this.setData({
        modal: {
          visible: true,
          title: '拒绝注册申请',
          content: '请填写拒绝原因，用户会在注册状态中看到该说明。',
          showInput: true,
          placeholder: '请输入拒绝原因',
          confirmText: '拒绝',
          confirmTone: 'danger',
          payload: { id, action },
        },
      })
      return
    }
    this.submitReview(id, action, '')
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  confirmModal(event) {
    const { id, action } = event.detail.payload
    const reason = event.detail.value || ''
    if (!reason) {
      wx.showToast({ title: '请填写拒绝原因', icon: 'none' })
      return
    }
    this.closeModal()
    this.submitReview(id, action, reason)
  },

  async submitReview(userId, action, reason) {
    try {
      await api.callFunction('reviewRegistration', { userId, action, reason })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },
})
