const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getPendingConfirmationApplication(userId, applicationId) {
  if (applicationId) {
    const app = (await db.collection('project_applications').doc(applicationId).get()).data
    if (!app || app.userId !== userId) return null
    return app
  }

  const res = await db.collection('project_applications').where({
    userId,
    status: 'approved',
    userConfirmedAt: null,
  }).orderBy('updatedAt', 'desc').limit(1).get()
  return res.data[0] || null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  const app = await getPendingConfirmationApplication(user._id, event.applicationId)
  if (!app) return fail('NOT_FOUND', '暂无待确认课题')
  if (app.status !== 'approved') return fail('STATE_CHANGED', '申请状态未就绪')
  if (!app.approvedProjectId) return fail('STATE_CHANGED', '课题尚未创建')

  const project = (await db.collection('projects').doc(app.approvedProjectId).get()).data
  if (!project || project.status !== 'active') return fail('PROJECT_INACTIVE', '课题不可用')

  const now = db.serverDate()
  await db.collection('project_applications').doc(app._id).update({ data: { userConfirmedAt: now, updatedAt: now } })
  await db.collection('users').doc(user._id).update({
    data: {
      projectId: project._id,
      projectName: project.name || '',
      projectAbbr: project.abbr || '',
      accountStatus: 'active',
      registrationStatus: 'approved',
      rejectReason: '',
      updatedAt: now,
    },
  })
  return ok({ applicationId: app._id, projectId: app.approvedProjectId, confirmed: true })
}
