const app = getApp()
const api = require('../../../utils/api')

Page({
  data: {
    loading: false,
    canSubmit: false,
    changeProjectFlow: false,
    form: {
      name: '',
      agreed: false,
    },
    projectMode: 'search',
    projectSearch: '',
    projectResults: [],
    selectedProjectId: '',
    selectedProjectName: '',
    selectedProjectAbbr: '',
    newProjectName: '',
    newProjectAbbr: '',
    searching: false,
  },

  onLoad(options) {
    this.projectSearchTimer = null
    this.projectSearchToken = 0
    const user = app.globalData.user || {}
    const alreadyAccepted = !app.needsLegalAcceptance() && !!(user.agreementVersion && user.privacyVersion)
    const changeProjectFlow = options && options.mode === 'change-project'
    this.setData({
      changeProjectFlow,
      'form.name': user.name || '',
      'form.agreed': alreadyAccepted,
      legalAlreadyAccepted: alreadyAccepted,
    }, () => this.checkCanSubmit())
  },

  onUnload() {
    if (this.projectSearchTimer) clearTimeout(this.projectSearchTimer)
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    if (field === 'newProjectName' || field === 'newProjectAbbr') {
      this.setData({ [field]: event.detail.value }, () => this.checkCanSubmit())
    } else {
      this.setData({ [`form.${field}`]: event.detail.value }, () => this.checkCanSubmit())
    }
  },

  onProjectInput(event) {
    const val = event.detail.value
    this.projectSearchToken += 1
    if (this.projectSearchTimer) clearTimeout(this.projectSearchTimer)
    this.setData({ projectSearch: val, selectedProjectId: '', selectedProjectName: '', selectedProjectAbbr: '' }, () => this.checkCanSubmit())
    if (val.length >= 2) {
      const currentToken = this.projectSearchToken
      this.projectSearchTimer = setTimeout(() => {
        this.searchProjects(val, currentToken)
      }, 250)
    } else {
      this.setData({ projectResults: [], searching: false })
    }
  },

  async searchProjects(keyword, token) {
    this.setData({ searching: true })
    try {
      const res = await api.callFunction('searchProjects', { keyword })
      if (token !== this.projectSearchToken || keyword !== this.data.projectSearch) return
      this.setData({ projectResults: res.items || [], searching: false })
    } catch (err) {
      if (token !== this.projectSearchToken || keyword !== this.data.projectSearch) return
      this.setData({ projectResults: [], searching: false })
    }
  },

  selectProject(event) {
    const project = event.currentTarget.dataset.project
    this.setData({
      selectedProjectId: project._id,
      selectedProjectName: project.name,
      selectedProjectAbbr: project.abbr,
      projectSearch: `${project.name}（${project.abbr}）`,
      projectResults: [],
    }, () => this.checkCanSubmit())
  },

  clearProject() {
    this.setData({
      selectedProjectId: '', selectedProjectName: '', selectedProjectAbbr: '',
      projectSearch: '', projectResults: [],
    }, () => this.checkCanSubmit())
  },

  switchToNewProject() {
    this.setData({ projectMode: 'new', selectedProjectId: '', selectedProjectName: '', selectedProjectAbbr: '' }, () => this.checkCanSubmit())
  },

  switchToSearch() {
    this.setData({ projectMode: 'search', newProjectName: '', newProjectAbbr: '' }, () => this.checkCanSubmit())
  },

  onAgreeChange() {
    this.setData({ 'form.agreed': !this.data.form.agreed }, () => this.checkCanSubmit())
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/legal/agreement/index' })
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/legal/privacy/index' })
  },

  checkCanSubmit() {
    const { form, selectedProjectId, newProjectName, newProjectAbbr, projectMode } = this.data
    let valid = !!(form.name && form.name.trim() && form.agreed)
    if (projectMode === 'new') valid = valid && !!(newProjectName && newProjectName.trim() && newProjectAbbr && newProjectAbbr.trim())
    else valid = valid && !!selectedProjectId
    this.setData({ canSubmit: valid })
  },

  async submit() {
    if (!this.data.canSubmit) {
      wx.showToast({ title: '请完整填写申请信息并同意协议', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const {
        form,
        projectMode,
        selectedProjectId,
        newProjectName,
        newProjectAbbr,
        changeProjectFlow,
      } = this.data
      if (projectMode === 'new') {
        await api.callFunction('submitProjectApplication', {
          name: form.name.trim(),
          proposedName: newProjectName.trim(),
          proposedAbbr: newProjectAbbr.trim(),
          agreed: true,
        })
        wx.showToast({
          title: changeProjectFlow ? '课题申请已提交，审核通过后需再次确认' : '课题申请已提交，等待管理员审核',
          icon: 'none',
          duration: 2500,
        })
      } else {
        if (changeProjectFlow) {
          await api.callFunction('requestProjectChange', {
            projectId: selectedProjectId,
          })
        } else {
          await api.callFunction('submitRegistrationV2', {
            name: form.name.trim(),
            projectId: selectedProjectId,
            agreed: true,
          })
        }
      }
      await app.refreshSession()
      wx.showToast({
        title: projectMode === 'new'
          ? '已提交课题申请'
          : (changeProjectFlow ? '已提交课题变更' : '已提交注册审核'),
        icon: 'success',
      })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (err) {
      api.showError(err)
    } finally {
      this.setData({ loading: false })
    }
  },
})
