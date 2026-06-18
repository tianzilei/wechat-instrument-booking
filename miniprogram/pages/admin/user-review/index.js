const api = require('../../../utils/api')

Page({
  data: {
    userItems: [],
    projectItems: [],
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
      const [registrationRes, projectRes] = await Promise.all([
        api.callFunction('listRegistrationReviews'),
        api.callFunction('listProjectApplications', { status: 'pending' }),
      ])
      this.setData({
        userItems: registrationRes.items || [],
        projectItems: projectRes.items || [],
      })
    } catch (err) {
      this.setData({ userItems: [], projectItems: [] })
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
          payload: { id, action, type: 'registration' },
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
    const { id, action, type } = event.detail.payload
    const reason = event.detail.value || ''
    if (!reason) {
      wx.showToast({ title: '请填写拒绝原因', icon: 'none' })
      return
    }
    this.closeModal()
    if (type === 'project') {
      this.submitProjectReview(id, 'reject', reason)
      return
    }
    this.submitReview(id, action, reason)
  },

  async submitReview(applicationId, action, reason) {
    try {
      await api.callFunction('reviewRegistrationV2', { applicationId, action, reason })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },

  approveProject(event) {
    const application = event.currentTarget.dataset.application
    wx.showModal({
      title: '通过课题申请',
      content: `将创建课题“${application.proposedName}” (${application.proposedAbbr})。`,
      editable: true,
      placeholderText: '可修改课题名称',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.callFunction('reviewProjectApplication', {
            applicationId: application._id,
            action: 'approve',
            finalName: res.content || application.proposedName,
            finalAbbr: application.proposedAbbr,
          })
          wx.showToast({ title: '已通过', icon: 'success' })
          this.loadItems()
        } catch (err) {
          api.showError(err)
        }
      },
    })
  },

  rejectProject(event) {
    const application = event.currentTarget.dataset.application
    this.setData({
      modal: {
        visible: true,
        title: '拒绝课题申请',
        content: '请填写拒绝原因，申请人会在课题状态中看到该说明。',
        showInput: true,
        placeholder: '请输入拒绝原因',
        confirmText: '拒绝',
        confirmTone: 'danger',
        payload: { id: application._id, type: 'project' },
      },
    })
  },

  async submitProjectReview(applicationId, action, reason) {
    try {
      await api.callFunction('reviewProjectApplication', { applicationId, action, reason })
      wx.showToast({ title: '已处理', icon: 'success' })
      this.loadItems()
    } catch (err) {
      api.showError(err)
    }
  },
})
