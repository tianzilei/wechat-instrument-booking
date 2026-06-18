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
      const data = await api.callFunction('listUsers')
      const items = (data.items || []).map((item) => ({
        ...item,
        accountStatus: item.accountStatus || 'active',
        statusText: item.accountStatus === 'suspended' ? '已暂停' : '正常',
        statusTone: item.accountStatus === 'suspended' ? 'danger' : 'success',
      }))
      this.setData({ items })
    } catch (err) {
      this.setData({ items: [] })
    }
  },

  suspendUser(event) {
    const { id, name } = event.currentTarget.dataset
    this.setData({
      modal: {
        visible: true,
        title: '暂停账号',
        content: `${name || '该用户'} 的未来预约和候补将被取消，请填写暂停原因。`,
        showInput: true,
        placeholder: '请输入暂停原因',
        confirmText: '确认暂停',
        confirmTone: 'danger',
        payload: { userId: id, action: 'suspend' },
      },
    })
  },

  restoreUser(event) {
    const { id, name } = event.currentTarget.dataset
    this.setData({
      modal: {
        visible: true,
        title: '恢复账号',
        content: `确认恢复 ${name || '该用户'} 的账号使用权限？`,
        showInput: false,
        placeholder: '',
        confirmText: '确认恢复',
        confirmTone: 'primary',
        payload: { userId: id, action: 'restore' },
      },
    })
  },

  closeModal() {
    this.setData({ 'modal.visible': false })
  },

  async confirmModal(event) {
    const { userId, action } = event.detail.payload
    const reason = event.detail.value || ''
    if (action === 'suspend' && !reason) {
      wx.showToast({ title: '请填写暂停原因', icon: 'none' })
      return
    }
    this.closeModal()
    try {
      if (action === 'suspend') {
        await api.callFunction('suspendUser', { userId, reason })
      } else {
        await api.callFunction('restoreUser', { userId })
      }
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },
})
