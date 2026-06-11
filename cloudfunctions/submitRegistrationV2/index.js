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

  if (!event.projectId) return fail('INVALID_PARAMS', '请先选择课题')
  if (event.agreed !== true) return fail('LEGAL_ACCEPTANCE_REQUIRED', '请先同意协议')

  const projectRes = await db.collection('projects').doc(event.projectId).field({
    _id: true,
    name: true,
    abbr: true,
    status: true,
  }).get()
  const project = projectRes.data
  if (!project || project.status !== 'active') return fail('PROJECT_INACTIVE', '课题不可用')

  const settingsRes = await db.collection('settings').doc('global').get()
  const settings = settingsRes.data || {}
  const agreementVersion = settings.serviceAgreementVersion || '1.0'
  const privacyVersion = settings.privacyPolicyVersion || '1.0'

  const existing = await db.collection('registration_applications').where({ userId: user._id, status: 'pending' }).limit(1).get()
  if (existing.data.length > 0) return fail('DUPLICATE', '已有待审核注册申请')

  const name = (event.name || '').trim()
  if (!name) return fail('INVALID_PARAMS', '请填写姓名')

  try {
    const checkRes = await cloud.openapi.security.msgSecCheck({ content: name })
    if (checkRes.result && checkRes.result.suggest === 'risky') {
      return fail('CONTENT_UNSAFE', '姓名包含违规信息')
    }
  } catch (err) {
    console.error('msgSecCheck error:', err.errCode || err.message)
  }

  const now = db.serverDate()
  const res = await db.collection('registration_applications').add({
    data: {
      userId: user._id,
      nameSnapshot: name,
      projectId: event.projectId,
      projectNameSnapshot: project.name,
      projectAbbrSnapshot: project.abbr,
      status: 'pending',
      reviewReason: '',
      agreementVersion, privacyVersion,
      reviewedBy: '',
      createdAt: now, updatedAt: now,
    },
  })
  return ok({ applicationId: res._id, status: 'pending' })
}
