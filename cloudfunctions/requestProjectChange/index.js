const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  if (!user.registrationStatus || user.registrationStatus !== 'approved') return fail('REGISTRATION_REQUIRED', '注册审核通过后才能申请课题变更')
  if (user.accountStatus && user.accountStatus !== 'active') return fail('ACCOUNT_SUSPENDED', '账号状态异常')

  if (!event.projectId) return fail('INVALID_PARAMS', '请选择课题')

  const project = (await db.collection('projects').doc(event.projectId).field({
    _id: true,
    name: true,
    abbr: true,
    status: true,
  }).get()).data
  if (!project || project.status !== 'active') return fail('PROJECT_INACTIVE', '课题不可用')
  if (user.projectId === event.projectId) return fail('STATE_CHANGED', '已是该课题成员')

  const existing = await db.collection('project_applications').where({
    userId: user._id,
    status: 'pending',
  }).limit(1).get()
  if (existing.data.length > 0) return fail('DUPLICATE', '已有待审核课题申请')

  const now = db.serverDate()
  const res = await db.collection('project_applications').add({
    data: {
      userId: user._id,
      proposedName: project.name,
      proposedAbbr: project.abbr,
      status: 'pending',
      approvedProjectId: event.projectId,
      reviewedBy: '',
      reviewReason: '',
      finalName: project.name,
      finalAbbr: project.abbr,
      createdAt: now,
      updatedAt: now,
    },
  })

  return ok({ applicationId: res._id, status: 'pending' })
}
