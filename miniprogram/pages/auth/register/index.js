const app = getApp()
const api = require('../../../utils/api')

Page({
  data: {
    loading: false,
    form: {
      name: '',
      phone: '',
      studentId: '',
      college: '',
      supervisor: '',
    },
  },

  onLoad() {
    const user = app.globalData.user || {}
    this.setData({
      form: {
        name: user.name || '',
        phone: user.phone || '',
        studentId: user.studentId || '',
        college: user.college || '',
        supervisor: user.supervisor || '',
      },
    })
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({
      [`form.${field}`]: event.detail.value,
    })
  },

  validate() {
    const { form } = this.data
    const required = ['name', 'phone', 'studentId', 'college', 'supervisor']
    const empty = required.find((field) => !form[field])
    if (empty) {
      wx.showToast({
        title: '请完整填写申请信息',
        icon: 'none',
      })
      return false
    }
    if (!/^1\d{10}$/.test(form.phone)) {
      wx.showToast({
        title: '手机号格式不正确',
        icon: 'none',
      })
      return false
    }
    return true
  },

  async submit() {
    if (!this.validate()) return
    this.setData({ loading: true })
    try {
      await api.callFunction('submitRegistration', this.data.form)
      await app.refreshSession()
      this.setData({ loading: false })
      wx.showToast({
        title: '已提交审核',
        icon: 'success',
      })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) {
      this.setData({ loading: false })
      api.showError(err)
    }
  },
})
