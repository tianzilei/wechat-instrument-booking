const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function getAdmin(openid) {
  if (!openid) return null
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')
  if (!event.applicationId) return fail('INVALID_PARAMS', '参数错误')

  const application = (await db.collection('project_applications').doc(event.applicationId).get()).data
  if (!application) return fail('NOT_FOUND', '课题申请不存在')

  let userName = ''
  if (application.userId) {
    try {
      const user = (await db.collection('users').doc(application.userId).field({ name: true }).get()).data
      userName = user && user.name ? user.name : ''
    } catch (err) {}
  }

  return ok({
    applicationId: application._id,
    userId: application.userId,
    userName,
    proposedName: application.proposedName || '',
    proposedAbbr: application.proposedAbbr || '',
    finalName: application.finalName || '',
    finalAbbr: application.finalAbbr || '',
    approvedProjectId: application.approvedProjectId || '',
    status: application.status || '',
    reviewReason: application.reviewReason || '',
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  })
}
