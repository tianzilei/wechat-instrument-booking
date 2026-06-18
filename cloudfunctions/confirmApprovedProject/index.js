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

  if (!event.applicationId) return fail('INVALID_PARAMS', '参数错误')
  const ref = db.collection('project_applications').doc(event.applicationId)
  const app = (await ref.get()).data
  if (!app || app.userId !== user._id) return fail('PERMISSION_DENIED', '无权操作此申请')
  if (app.status !== 'approved') return fail('STATE_CHANGED', '申请状态未就绪')
  if (!app.approvedProjectId) return fail('STATE_CHANGED', '课题尚未创建')

  const project = (await db.collection('projects').doc(app.approvedProjectId).get()).data
  if (!project || project.status !== 'active') return fail('PROJECT_INACTIVE', '课题不可用')

  const now = db.serverDate()
  await ref.update({ data: { userConfirmedAt: now, updatedAt: now } })
  await db.collection('users').doc(user._id).update({
    data: {
      projectId: project._id,
      projectName: project.name || '',
      projectAbbr: project.abbr || '',
      accountStatus: 'active',
      registrationStatus: 'approved',
      updatedAt: now,
    },
  })
  return ok({ applicationId: event.applicationId, projectId: app.approvedProjectId, confirmed: true })
}
