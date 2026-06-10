const app = getApp()
const api = require('../../utils/api')
const dateUtils = require('../../utils/date')
const { setTabBarSelected } = require('../../utils/tabbar')

function formatMonthDay(dateText) {
  const date = new Date(`${dateText}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

Page({
  data: {
    weekStart: '',
    weekTitle: '',
    userHint: '未登录用户可查看占用情况',
    serviceMode: 'normal',
    includeNight: false,
    days: [],
    hours: [],
    items: [],
    maintenanceSlots: [],
    restrictedSlots: [],
    selectedRange: null,
    sheet: {
      visible: false,
      title: '预约仪器',
      timeText: '',
      hint: '',
      hintTone: 'warning',
      submitText: '确认预约',
      disabled: false,
      mode: 'booking',
    },
  },

  onLoad() {
    const weekStart = dateUtils.getWeekStart()
    this.setWeek(weekStart)
  },

  onShow() {
    setTabBarSelected(this, 0)
    this.refreshUserHint()
    this.loadCalendar()
  },

  setWeek(weekStart) {
    const days = dateUtils.getWeekDays(weekStart)
    const hours = dateUtils.getHours(this.data.includeNight)
    this.setData({
      weekStart: dateUtils.formatDate(weekStart),
      weekTitle: `${formatMonthDay(days[0].date)}-${formatMonthDay(days[6].date)}`,
      days,
      hours,
    })
  },

  refreshUserHint() {
    const user = app.globalData.user
    let userHint = '未登录用户可查看占用情况'
    if (user && user.registrationStatus === 'approved') {
      userHint = `${user.name || '已登录'}，可预约仪器`
    } else if (user && user.registrationStatus === 'pending') {
      userHint = '注册申请审核中，暂不可预约'
    } else if (user && user.registrationStatus === 'rejected') {
      userHint = '注册申请未通过，可重新提交'
    } else if (user) {
      userHint = '请提交注册申请后预约'
    }
    this.setData({ userHint })
  },

  async loadCalendar() {
    try {
      const data = await api.callFunction('getPublicCalendar', {
        weekStartDate: this.data.weekStart,
      })

      const items = []
      const maintenanceSlots = []
      const restrictedSlots = []

      ;(data.slots || []).forEach((slot) => {
        if (slot.state === 'maintenance') {
          maintenanceSlots.push({ startAt: slot.startAt, endAt: slot.endAt, reason: '', status: 'maintenance' })
        } else if (slot.state === 'restricted') {
          restrictedSlots.push({ startAt: slot.startAt, endAt: slot.endAt, reason: '', status: 'restricted' })
        } else {
          items.push({
            type: 'booking',
            bookingId: slot.publicRenderId,
            status: slot.state === 'occupied' ? 'confirmed' : 'pending_review',
            startAt: slot.startAt,
            endAt: slot.endAt,
            projectAbbr: slot.projectAbbr || '',
            userName: '',
          })
        }
      })

      const serviceMode = data.serviceMode || 'normal'
      let userHint = this.data.userHint
      if (serviceMode === 'maintenance' || serviceMode === 'rule_migrating') {
        userHint = '系统维护中，暂不支持预约'
      }

      this.setData({ items, maintenanceSlots, restrictedSlots, userHint, serviceMode })
    } catch (err) {
      this.setData({ items: [], maintenanceSlots: [], restrictedSlots: [] })
    }
  },

  prevWeek() {
    this.setWeek(dateUtils.addDays(new Date(`${this.data.weekStart}T00:00:00`), -7))
    this.loadCalendar()
  },

  nextWeek() {
    this.setWeek(dateUtils.addDays(new Date(`${this.data.weekStart}T00:00:00`), 7))
    this.loadCalendar()
  },

  showWorktime() {
    this.setData({
      includeNight: false,
      hours: dateUtils.getHours(false),
    })
    this.loadCalendar()
  },

  showFullDay() {
    this.setData({
      includeNight: true,
      hours: dateUtils.getHours(true),
    })
    this.loadCalendar()
  },

  onSelectRange(event) {
    if (!app.globalData.user) {
      wx.navigateTo({ url: '/pages/auth/login/index' })
      return
    }
    const user = app.globalData.user
    if (user.accountStatus && user.accountStatus !== 'active') {
      wx.showToast({ title: '账号状态异常，暂不可预约', icon: 'none' })
      return
    }
    if (!app.isApprovedUser()) {
      wx.navigateTo({ url: '/pages/auth/register/index' })
      return
    }

    const range = dateUtils.buildRangeFromCells(event.detail.startCell, event.detail.endCell)
    if (!range) return
    const timeText = `${dateUtils.formatDateTime(range.startAt)} - ${dateUtils.formatDateTime(range.endAt)}`
    const isSpecial = !dateUtils.isWorkingHour(range.startAt) || !dateUtils.isWorkingHour(new Date(range.endAt.getTime() - 1))
    this.setData({
      selectedRange: range,
      sheet: {
        visible: true,
        title: isSpecial ? '提交特殊时段审核' : '预约仪器',
        timeText,
        hint: isSpecial ? '该时段命中非工作时间或周末，提交后需管理员审核。' : '',
        hintTone: 'warning',
        submitText: isSpecial ? '提交审核' : '确认预约',
        disabled: false,
        mode: 'booking',
      },
    })
  },

  closeSheet() {
    this.setData({
      selectedRange: null,
      'sheet.visible': false,
    })
  },

  async submitSheet(event) {
    const range = this.data.selectedRange
    if (!range) return

    const serviceMode = this.data.serviceMode || 'normal'
    if (serviceMode !== 'normal') {
      wx.showToast({ title: '系统维护中', icon: 'none' })
      return
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    wx.showLoading({ title: '提交中' })
    try {
      await api.callFunction('createBookingV2', {
        requestId,
        segments: [{ startAt: range.startAt.toISOString(), endAt: range.endAt.toISOString() }],
        remark: event.detail.remark || '',
      })
      wx.hideLoading()
      wx.showToast({ title: '已提交', icon: 'success' })
      this.closeSheet()
      this.loadCalendar()
    } catch (err) {
      wx.hideLoading()
      api.showError(err)
    }
  },
})
