const bookingStatusMap = {
  pending_review: { text: '待审核', tone: 'warning' },
  confirmed: { text: '已预约', tone: 'success' },
  completed: { text: '已完成', tone: 'muted' },
  cancel_pending: { text: '取消审核中', tone: 'warning' },
  cancelled: { text: '已取消', tone: 'muted' },
  maintenance_cancelled: { text: '维护取消', tone: 'muted' },
  rejected: { text: '已拒绝', tone: 'danger' },
  review_timeout: { text: '审核超时', tone: 'muted' },
  rule_rejected: { text: '规则复审未通过', tone: 'danger' },
  rule_review_pending: { text: '规则复审中', tone: 'warning' },
  waitlisted: { text: '候补中', tone: 'accent' },
  waitlist_confirming: { text: '待确认', tone: 'accent' },
  waitlist_expired: { text: '已过期', tone: 'muted' },
  waitlist_cancelled: { text: '已取消', tone: 'muted' },
  waitlist_converted: { text: '已转预约', tone: 'success' },
}

const registrationStatusMap = {
  unsubmitted: { text: '未提交', tone: 'muted' },
  project_pending: { text: '课题审核中', tone: 'warning' },
  project_confirm_required: { text: '待确认课题', tone: 'accent' },
  registration_pending: { text: '注册审核中', tone: 'warning' },
  approved: { text: '已通过', tone: 'success' },
  rejected: { text: '已拒绝', tone: 'danger' },
}

function normalizeRegistrationStatus(status) {
  if (status === 'pending') return 'registration_pending'
  return status || 'unsubmitted'
}

function getBookingStatus(status) {
  return bookingStatusMap[status] || { text: status || '未知', tone: 'muted' }
}

function getRegistrationStatus(status) {
  const normalizedStatus = normalizeRegistrationStatus(status)
  return registrationStatusMap[normalizedStatus] || { text: normalizedStatus || '未知', tone: 'muted' }
}

function getCellClass(status) {
  const map = {
    available: 'calendar-cell--available',
    confirmed: 'calendar-cell--booked',
    pending_review: 'calendar-cell--pending',
    cancel_pending: 'calendar-cell--pending',
    rule_review_pending: 'calendar-cell--pending',
    maintenance: 'calendar-cell--maintenance',
    selected: 'calendar-cell--selected',
    past: 'calendar-cell--past',
  }
  return map[status] || 'calendar-cell--available'
}

module.exports = {
  getBookingStatus,
  getRegistrationStatus,
  getCellClass,
  normalizeRegistrationStatus,
}
