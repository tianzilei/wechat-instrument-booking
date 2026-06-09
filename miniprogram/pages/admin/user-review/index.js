const api = require('../../../utils/api')

Page({
  data: {
    items: [],
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
      wx.showModal({
        title: '拒绝原因',
        editable: true,
        placeholderText: '请输入拒绝原因',
        success: (res) => {
          if (res.confirm) this.submitReview(id, action, res.content || '')
        },
      })
      return
    }
    this.submitReview(id, action, '')
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
