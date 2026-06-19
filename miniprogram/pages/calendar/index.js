const app = getApp()
const api = require('../../utils/api')
const dateUtils = require('../../utils/date')
const { getBookingStatus } = require('../../utils/status')
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

function buildSegmentsFromCells(cells) {
  if (!Array.isArray(cells) || cells.length === 0) return []
  const sorted = cells.slice().sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date)
    return dateCompare === 0 ? a.hour - b.hour : dateCompare
  })
  const segments = []
  sorted.forEach((cell) => {
    const startAt = dateUtils.toCellDate(cell.date, Number(cell.hour))
    const endAt = dateUtils.toCellDate(cell.date, Number(cell.hour) + 1)
    const last = segments[segments.length - 1]
    if (last && last.endAt.getTime() === startAt.getTime()) {
      last.endAt = endAt
    } else {
      segments.push({ startAt, endAt })
    }
  })
  return segments
}

function formatSegmentsText(segments) {
  if (!segments || segments.length === 0) return ''
  return segments.map((segment) => `${dateUtils.formatDateTime(segment.startAt)} - ${dateUtils.formatTime(segment.endAt)}`).join('；')
}

function segmentsContainSpecialTime(segments) {
  return segments.some((segment) => (
    !dateUtils.isWorkingHour(segment.startAt)
    || !dateUtils.isWorkingHour(new Date(segment.endAt.getTime() - 1))
  ))
}

function getSheetPrimaryClass(mode) {
  return mode === 'waitlist' ? 'sheet__action--secondary' : 'sheet__action--primary'
}

function buildShareTitle(weekTitle) {
  return weekTitle ? `仪器预约周历｜${weekTitle}` : '仪器预约周历'
}

function buildUserHint() {
  const user = app.globalData.user
  if (app.isAdmin()) {
    return '管理员可查看预约人并直接创建维护'
  }
  if (user && app.needsLegalAcceptance()) {
    return '请先同意最新协议与隐私政策后再预约'
  }
  if (user && user.registrationStatus === 'approved') {
    return `${user.name || '已登录'}，可预约仪器`
  }
  if (user && user.registrationStatus === 'registration_pending') {
    return '注册申请审核中，暂不可预约'
  }
  if (user && user.registrationStatus === 'project_pending') {
    return '课题申请审核中，待通过后继续完成注册'
  }
  if (user && user.registrationStatus === 'project_confirm_required') {
    return '课题已通过，请先确认课题后完成注册'
  }
  if (user && user.registrationStatus === 'rejected') {
    return '注册申请未通过，可重新提交'
  }
  if (user) {
    return '请提交注册申请后预约'
  }
  return '未登录用户可查看占用情况'
}

function buildRangeTimeText(range) {
  return `${dateUtils.formatDateTime(range.startAt)} - ${dateUtils.formatTime(range.endAt)}`
}

function buildOccupiedHint(user) {
  if (!user) {
    return '登录并通过注册审核后，可在这里加入候补排队。'
  }
  if (app.needsLegalAcceptance()) {
    return '请先同意最新协议与隐私政策后，再加入候补排队。'
  }
  if (user.accountStatus && user.accountStatus !== 'active') {
    return '当前账号状态异常，暂不可加入候补。'
  }
  if (!app.isApprovedUser()) {
    return '注册审核通过并关联课题后，可在这里加入候补排队。'
  }
  return '该时段已被占用，可加入候补排队；时段释放后将按顺序确认。'
}

function goLegalAcceptance() {
  wx.navigateTo({ url: '/pages/auth/login/index' })
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
    selectedSegments: [],
    sheet: {
      visible: false,
      title: '预约仪器',
      timeText: '',
      hint: '',
      hintTone: 'warning',
      submitText: '确认预约',
      cancelText: '取消',
      disabled: false,
      mode: 'booking',
      primaryClass: 'sheet__action--primary',
      showSubmit: true,
      showRemark: true,
      detailLines: [],
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
            maintenanceId: slot.maintenanceId || '',
            startAt: slot.startAt,
            endAt: slot.endAt,
            reason: '',
            status: 'maintenance',
          })
        } else {
          const bookingStatus = slot.status || (slot.state === 'occupied' ? 'confirmed' : 'pending_review')
          items.push({
            type: 'booking',
            bookingId: slot.bookingId || '',
            status: bookingStatus,
            startAt: slot.startAt,
            endAt: slot.endAt,
            projectAbbr: slot.projectAbbr || '',
            userName: slot.userName || '',
            publicRenderId: slot.publicRenderId || '',
          })
        }
      })

      const serviceMode = data.serviceMode || 'normal'
      let userHint = buildUserHint()
      if (serviceMode === 'maintenance') {
        userHint = '系统维护中，暂不支持预约'
      } else if (serviceMode === 'rule_migrating') {
        userHint = '预约规则更新中，暂不支持预约'
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

  openBookingSheet(segments, entries) {
    if (!app.globalData.user) {
      wx.navigateTo({ url: '/pages/auth/login/index' })
      return
    }
    const user = app.globalData.user
    if (user.accountStatus && user.accountStatus !== 'active') {
      wx.showToast({ title: '账号状态异常，暂不可预约', icon: 'none' })
      return
    }
    if (app.needsLegalAcceptance()) {
      wx.showToast({ title: '请先同意最新协议', icon: 'none' })
      goLegalAcceptance()
      return
    }
    if (!app.isApprovedUser()) {
      wx.navigateTo({ url: '/pages/auth/register/index' })
      return
    }
    if (!segments || segments.length === 0) return
    if (entries && entries.some((item) => item.status !== 'available')) {
      wx.showToast({ title: '请选择空闲时段', icon: 'none' })
      return
    }
    const timeText = formatSegmentsText(segments)
    const isSpecial = segmentsContainSpecialTime(segments)
    this.setData({
      selectedRange: null,
      selectedSegments: segments,
      sheet: {
        visible: true,
        title: isSpecial ? '提交特殊时段审核' : '预约仪器',
        timeText,
        hint: isSpecial ? '该时段命中非工作时间或周末，提交后需管理员审核。' : '',
        hintTone: 'warning',
        submitText: isSpecial ? '提交审核' : '确认预约',
        cancelText: '取消',
        disabled: false,
        mode: 'booking',
        primaryClass: getSheetPrimaryClass('booking'),
        showSubmit: true,
        showRemark: true,
        detailLines: [],
      },
    })
  },

  openWaitlistSheet(cell) {
    if (!app.globalData.user) {
      wx.navigateTo({ url: '/pages/auth/login/index' })
      return
    }
    const user = app.globalData.user
    if (user.accountStatus && user.accountStatus !== 'active') {
      wx.showToast({ title: '账号状态异常，暂不可候补', icon: 'none' })
      return
    }
    if (app.needsLegalAcceptance()) {
      wx.showToast({ title: '请先同意最新协议', icon: 'none' })
      goLegalAcceptance()
      return
    }
    if (!app.isApprovedUser()) {
      wx.navigateTo({ url: '/pages/auth/register/index' })
      return
    }
    const range = this.buildSingleRange(cell)
    if (!range) return
    this.setData({
      selectedRange: null,
      selectedSegments: [range],
      sheet: {
        visible: true,
        title: '加入候补',
        timeText: buildRangeTimeText(range),
        hint: '该时段已被占用。提交后进入候补队列，时段释放时按顺序确认。',
        hintTone: 'accent',
        submitText: '加入候补',
        cancelText: '取消',
        disabled: false,
        mode: 'waitlist',
        primaryClass: getSheetPrimaryClass('waitlist'),
        showSubmit: true,
        showRemark: true,
        detailLines: [],
      },
    })
  },

  openOccupiedSheet(cell, cellData) {
    const range = this.buildSingleRange(cell)
    if (!range) return
    const user = app.globalData.user
    const status = getBookingStatus(cellData.status)
    const allowWaitlist = !!(user && app.isApprovedUser() && !app.isAdmin() && !app.needsLegalAcceptance())
    const detailLines = [
      {
        label: '课题',
        value: cellData.projectAbbr || '已占用',
      },
      ...(cellData.userName ? [{
        label: '预约人',
        value: cellData.userName,
      }] : []),
      {
        label: '状态',
        value: status.text,
      },
    ]
    this.setData({
      selectedRange: null,
      selectedSegments: allowWaitlist ? [range] : [],
      sheet: {
        visible: true,
        title: '时段信息',
        timeText: buildRangeTimeText(range),
        hint: buildOccupiedHint(user),
        hintTone: allowWaitlist ? 'accent' : 'warning',
        submitText: '加入候补',
        cancelText: '关闭',
        disabled: !allowWaitlist,
        mode: allowWaitlist ? 'waitlist' : 'info',
        primaryClass: getSheetPrimaryClass('waitlist'),
        showSubmit: allowWaitlist,
        showRemark: allowWaitlist,
        detailLines,
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
      if ((cellData.status === 'confirmed' || cellData.status === 'pending_review' || cellData.status === 'rule_review_pending' || cellData.status === 'cancel_pending') && cellData.bookingId) {
        const mode = cellData.status === 'pending_review' ? '&mode=review' : ''
        wx.navigateTo({ url: `/pages/admin/booking-detail/index?bookingId=${cellData.bookingId}${mode}` })
        return
      }
      this.openMaintenancePreview(this.buildSingleRange(cell))
      return
    }
    if (cellData.status !== 'available') {
      if (cellData.status === 'confirmed' || cellData.status === 'pending_review' || cellData.status === 'rule_review_pending' || cellData.status === 'cancel_pending') {
        this.openOccupiedSheet(cell, cellData)
      }
      return
    }
    this.openBookingSheet([this.buildSingleRange(cell)], [{ status: 'available' }])
  },

  onSelectRange(event) {
    const selectedCells = event.detail.selectedCells || []
    const segments = buildSegmentsFromCells(selectedCells)
    const range = dateUtils.buildRangeFromCells(event.detail.startCell, event.detail.endCell)
    const selectedEntries = event.detail.selectedEntries || []
    if (this.data.isAdminView) {
      this.openMaintenancePreview(range)
      return
    }
    this.openBookingSheet(segments, selectedEntries)
  },

  onSelectModeChange(event) {
    this.setData({ isSelecting: !!event.detail.selecting })
  },

  closeSheet() {
    this.setData({
      selectedRange: null,
      selectedSegments: [],
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
    const segments = this.data.selectedSegments || []
    if (segments.length === 0) return

    const serviceMode = this.data.serviceMode || 'normal'
    if (serviceMode !== 'normal') {
      wx.showToast({ title: '系统维护中', icon: 'none' })
      return
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    wx.showLoading({ title: '提交中' })
    try {
      const payload = {
        segments: segments.map((segment) => ({
          startAt: segment.startAt.toISOString(),
          endAt: segment.endAt.toISOString(),
        })),
        remark: event.detail.remark || '',
      }
      let toastTitle = '已提交'
      if (this.data.sheet.mode === 'waitlist') {
        const result = await api.callFunction('createWaitlistV2', payload)
        toastTitle = result && result.duplicateRequest ? '候补已存在' : '已加入候补'
      } else {
        const result = await api.callFunction('createBookingV2', {
          requestId,
          ...payload,
        })
        if (result && result.status === 'pending_review') {
          toastTitle = result.duplicateRequest ? '预约申请已存在' : '已提交审核'
        } else {
          toastTitle = result && result.duplicateRequest ? '预约已存在' : '预约成功'
        }
      }
      wx.hideLoading()
      wx.showToast({ title: toastTitle, icon: 'success' })
      this.closeSheet()
      this.loadCalendar()
    } catch (err) {
      wx.hideLoading()
      if (err && err.code === 'LEGAL_ACCEPTANCE_REQUIRED') {
        app.globalData.needsLegalAcceptance = true
        this.refreshUserHint()
        wx.showToast({ title: '请先同意最新协议', icon: 'none' })
        goLegalAcceptance()
        return
      }
      if (err && err.code === 'STATE_CHANGED') {
        wx.showToast({ title: err.message || '状态已变化，请刷新后重试', icon: 'none' })
        this.loadCalendar()
        return
      }
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
