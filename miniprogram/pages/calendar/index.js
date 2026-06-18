const app = getApp()
const api = require('../../utils/api')
const dateUtils = require('../../utils/date')
const { setTabBarSelected } = require('../../utils/tabbar')

const HOME_SHARE_PATH = '/pages/calendar/index'
const DEFAULT_MAX_ADVANCE_DAYS = 7

function formatMonthDay(dateText) {
  const date = new Date(`${dateText}T00:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatHintDate(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function buildShareTitle(weekTitle) {
  return weekTitle ? `仪器预约周历｜${weekTitle}` : '仪器预约周历'
}

function buildUserHint() {
  const user = app.globalData.user
  if (app.isAdmin()) {
    return '管理员可查看预约人并直接创建维护'
  }
  if (user && user.registrationStatus === 'approved') {
    return `${user.name || '已登录'}，可预约仪器`
  }
  if (user && user.registrationStatus === 'pending') {
    return '注册申请审核中，暂不可预约'
  }
  if (user && user.registrationStatus === 'rejected') {
    return '注册申请未通过，可重新提交'
  }
  if (user) {
    return '请提交注册申请后预约'
  }
  return '未登录用户可查看占用情况'
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
    isAdminView: false,
    isSelecting: false,
    bookingWindowHint: '',
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
    maintenanceModal: {
      visible: false,
      title: '维护仪器',
      content: '',
      confirmText: '确认维护',
      confirmTone: 'danger',
      payload: {},
    },
  },

  onLoad() {
    const weekStart = dateUtils.getWeekStart()
    this.setWeek(weekStart)
  },

  onShow() {
    setTabBarSelected(this, 0)
    this.setData({ isAdminView: app.isAdmin() })
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
    this.setData({ userHint: buildUserHint() })
  },

  updateBookingWindowHint(serverNow, maxAdvanceDays) {
    const base = new Date(serverNow || Date.now())
    base.setHours(0, 0, 0, 0)
    base.setDate(base.getDate() + maxAdvanceDays)
    this.setData({
      bookingWindowHint: `按自然日开放，可预约至 ${formatHintDate(base)} 全天；当前小时不可预约。`,
    })
  },

  async loadCalendar() {
    try {
      const data = await api.callFunction('getPublicCalendar', {
        weekStartDate: this.data.weekStart,
      })

      const items = []
      const maintenanceSlots = []

      ;(data.slots || []).forEach((slot) => {
        if (slot.state === 'maintenance') {
          maintenanceSlots.push({
            maintenanceId: slot.maintenanceId || slot.publicRenderId,
            startAt: slot.startAt,
            endAt: slot.endAt,
            reason: '',
            status: 'maintenance',
          })
        } else {
          items.push({
            type: 'booking',
            bookingId: slot.bookingId || slot.publicRenderId,
            status: slot.state === 'occupied' ? 'confirmed' : 'pending_review',
            startAt: slot.startAt,
            endAt: slot.endAt,
            projectAbbr: slot.projectAbbr || '',
            userName: slot.userName || '',
          })
        }
      })

      const serviceMode = data.serviceMode || 'normal'
      let userHint = buildUserHint()
      if (serviceMode === 'maintenance' || serviceMode === 'rule_migrating') {
        userHint = '系统维护中，暂不支持预约'
      }

      this.updateBookingWindowHint(data.serverNow, data.maxAdvanceDays || DEFAULT_MAX_ADVANCE_DAYS)
      this.setData({ items, maintenanceSlots, userHint, serviceMode })
    } catch (err) {
      this.setData({ items: [], maintenanceSlots: [] })
    }
  },

  prevWeek() {
    if (this.data.isSelecting) {
      wx.showToast({ title: '多选中不可切换周，请先退出选择', icon: 'none' })
      return
    }
    this.setWeek(dateUtils.addDays(new Date(`${this.data.weekStart}T00:00:00`), -7))
    this.loadCalendar()
  },

  nextWeek() {
    if (this.data.isSelecting) {
      wx.showToast({ title: '多选中不可切换周，请先退出选择', icon: 'none' })
      return
    }
    this.setWeek(dateUtils.addDays(new Date(`${this.data.weekStart}T00:00:00`), 7))
    this.loadCalendar()
  },

  onShareAppMessage() {
    return {
      title: buildShareTitle(this.data.weekTitle),
      path: HOME_SHARE_PATH,
    }
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

  buildSingleRange(cell) {
    return dateUtils.buildRangeFromCells(cell, cell)
  },

  openBookingSheet(range, entries) {
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
    if (!range) return
    if (entries && entries.some((item) => item.status !== 'available')) {
      wx.showToast({ title: '请选择空闲时段', icon: 'none' })
      return
    }
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

  async openMaintenancePreview(range) {
    if (!range) return
    wx.showLoading({ title: '计算中' })
    try {
      const preview = await api.callFunction('createMaintenance', {
        startAt: range.startAt.toISOString(),
        endAt: range.endAt.toISOString(),
        previewOnly: true,
      })
      wx.hideLoading()
      this.setData({
        selectedRange: range,
        maintenanceModal: {
          visible: true,
          title: '维护仪器',
          content: `起止时间：${dateUtils.formatDateTime(range.startAt)} - ${dateUtils.formatDateTime(range.endAt)}；总时长：${preview.durationHours} 小时；受影响预约：${preview.affectedBookingCount} 条；将取消未来有效预约。`,
          confirmText: '确认维护',
          confirmTone: 'danger',
          payload: {
            startAt: range.startAt.toISOString(),
            endAt: range.endAt.toISOString(),
          },
        },
      })
    } catch (err) {
      wx.hideLoading()
      api.showError(err)
    }
  },

  onGridCellTap(event) {
    const { cell, cellData } = event.detail
    if (!cellData || cellData.status === 'past') return
    if (this.data.isAdminView) {
      if (cellData.status === 'maintenance' && cellData.maintenanceId) {
        wx.navigateTo({ url: `/pages/admin/maintenance/index?maintenanceId=${cellData.maintenanceId}` })
        return
      }
      if ((cellData.status === 'confirmed' || cellData.status === 'pending_review') && cellData.bookingId) {
        const mode = cellData.status === 'pending_review' ? '&mode=review' : ''
        wx.navigateTo({ url: `/pages/admin/booking-detail/index?bookingId=${cellData.bookingId}${mode}` })
        return
      }
      this.openMaintenancePreview(this.buildSingleRange(cell))
      return
    }
    if (cellData.status !== 'available') return
    this.openBookingSheet(this.buildSingleRange(cell), [{ status: 'available' }])
  },

  onSelectRange(event) {
    const range = dateUtils.buildRangeFromCells(event.detail.startCell, event.detail.endCell)
    const selectedEntries = event.detail.selectedEntries || []
    if (this.data.isAdminView) {
      this.openMaintenancePreview(range)
      return
    }
    this.openBookingSheet(range, selectedEntries)
  },

  onSelectModeChange(event) {
    this.setData({ isSelecting: !!event.detail.selecting })
  },

  closeSheet() {
    this.setData({
      selectedRange: null,
      'sheet.visible': false,
    })
  },

  closeMaintenanceModal() {
    this.setData({
      selectedRange: null,
      'maintenanceModal.visible': false,
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

  async confirmMaintenanceModal(event) {
    const { startAt, endAt } = event.detail.payload
    this.closeMaintenanceModal()
    try {
      await api.callFunction('createMaintenance', { startAt, endAt })
      wx.showToast({ title: '已新增', icon: 'success' })
      this.loadCalendar()
    } catch (err) {
      api.showError(err)
    }
  },
})
