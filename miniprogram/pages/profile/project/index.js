const api = require('../../../utils/api')
const dateUtils = require('../../../utils/date')
const { getBookingStatus } = require('../../../utils/status')

function getMemberTag(member) {
  if (member.role === 'admin') {
    return { text: '管理员', tone: 'danger' }
  }
  if (member.accountStatus === 'project_reassignment_required') {
    return { text: '待重分配', tone: 'warning' }
  }
  if (member.accountStatus === 'suspended') {
    return { text: '已暂停', tone: 'danger' }
  }
  if (member.accountStatus === 'deleting') {
    return { text: '注销中', tone: 'warning' }
  }
  return { text: '正常', tone: 'success' }
}

function getProjectTag(project) {
  if (!project || project.status === 'missing') {
    return { text: '待核对', tone: 'warning' }
  }
  if (project.status === 'inactive') {
    return { text: '已停用', tone: 'warning' }
  }
  return { text: '运行中', tone: 'success' }
}

function buildBookingView(item) {
  const status = getBookingStatus(item.status)
  return {
    ...item,
    userName: item.userName || '未命名成员',
    timeText: `${dateUtils.formatDateTime(item.startAt)} - ${dateUtils.formatDateTime(item.endAt)}`,
    statusText: status.text,
    statusTone: status.tone,
    hoursText: `${item.durationHours || 0} 小时`,
  }
}

Page({
  data: {
    loading: true,
    accessible: true,
    errorTitle: '',
    errorDescription: '',
    notice: '',
    scopeDays: 7,
    project: null,
    projectStatusText: '',
    projectStatusTone: 'muted',
    summary: {
      memberCount: 0,
      activeMemberCount: 0,
      futureBookingCount: 0,
      recentBookingCount: 0,
    },
    members: [],
    futureBookings: [],
    recentBookings: [],
  },

  onShow() {
    this.loadOverview()
  },

  async loadOverview() {
    this.setData({ loading: true })
    try {
      const result = await api.callFunctionRaw('getMyProjectOverview')
      if (!result.success) {
        this.setData({
          loading: false,
          accessible: false,
          errorTitle: '暂不可查看',
          errorDescription: (result.error && result.error.message) || '课题信息暂不可用',
          project: null,
          members: [],
          futureBookings: [],
          recentBookings: [],
        })
        return
      }

      const data = result.data || {}
      const projectTag = getProjectTag(data.project)
      const members = (data.members || []).map((member) => {
        const tag = getMemberTag(member)
        return {
          ...member,
          tagText: tag.text,
          tagTone: tag.tone,
        }
      })

      this.setData({
        loading: false,
        accessible: true,
        errorTitle: '',
        errorDescription: '',
        notice: data.notice || '',
        scopeDays: data.scopeDays || 7,
        project: data.project || null,
        projectStatusText: projectTag.text,
        projectStatusTone: projectTag.tone,
        summary: {
          memberCount: 0,
          activeMemberCount: 0,
          futureBookingCount: 0,
          recentBookingCount: 0,
          ...(data.summary || {}),
        },
        members,
        futureBookings: (data.futureBookings || []).map(buildBookingView),
        recentBookings: (data.recentBookings || []).map(buildBookingView),
      })
    } catch (err) {
      this.setData({
        loading: false,
        accessible: false,
        errorTitle: '加载失败',
        errorDescription: '课题信息获取失败，请稍后重试。',
        project: null,
        members: [],
        futureBookings: [],
        recentBookings: [],
      })
    }
  },
})
