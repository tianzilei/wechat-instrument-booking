const app = getApp()
const api = require('../../utils/api')
const dateUtils = require('../../utils/date')

function formatMonthDay(dateText) {
  const date = new Date(`${dateText}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

Page({
  data: {
    weekStart: '',
    weekTitle: '',
    userHint: '未登录用户可查看占用情况',
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
      const data = await api.callFunction('getCalendarBookings', {
        weekStartDate: this.data.weekStart,
        includeNight: this.data.includeNight,
      })
      this.setData({
        items: data.items || [],
        maintenanceSlots: data.maintenanceSlots || [],
        restrictedSlots: data.restrictedSlots || [],
      })
    } catch (err) {
      this.setData({
        items: [],
        maintenanceSlots: [],
        restrictedSlots: [],
      })
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
    wx.showLoading({ title: '提交中' })
    try {
      await api.callFunction('createBooking', {
        startAt: range.startAt.toISOString(),
        endAt: range.endAt.toISOString(),
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
