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

  const application = (await db.collection('registration_applications').doc(event.applicationId).get()).data
  if (!application) return fail('NOT_FOUND', '注册申请不存在')

  return ok({
    applicationId: application._id,
    userId: application.userId,
    nameSnapshot: application.nameSnapshot || '',
    projectId: application.projectId || '',
    projectName: application.projectNameSnapshot || '',
    projectAbbr: application.projectAbbrSnapshot || '',
    agreementVersion: application.agreementVersion || '',
    privacyVersion: application.privacyVersion || '',
    status: application.status || '',
    reviewReason: application.reviewReason || '',
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  })
}
