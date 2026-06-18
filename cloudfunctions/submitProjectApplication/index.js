const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getOrCreateUser(openid, now, agreementVersion, privacyVersion) {
  const userRes = await db.collection('users').where({ openid }).limit(1).get()
  const existing = userRes.data[0]
  if (existing) return existing

  const addRes = await db.collection('users').add({
    data: {
      openid,
      role: 'user',
      registrationStatus: 'unsubmitted',
      accountStatus: 'active',
      name: '',
      projectId: '',
      projectName: '',
      projectAbbr: '',
      agreementVersion,
      agreementAcceptedAt: now,
      privacyVersion,
      privacyAcceptedAt: now,
      rejectReason: '',
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    },
  })

  return {
    _id: addRes._id,
    role: 'user',
    registrationStatus: 'unsubmitted',
    accountStatus: 'active',
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const proposedName = (event.proposedName || '').trim()
  const proposedAbbr = (event.proposedAbbr || '').trim()
  if (!proposedName || !proposedAbbr) return fail('INVALID_PARAMS', '课题名称和缩写不能为空')
  if (event.agreed !== true) return fail('LEGAL_ACCEPTANCE_REQUIRED', '请先同意协议')

  let settings = {}
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    settings = settingsRes.data || {}
  } catch (err) {}
  const agreementVersion = settings.serviceAgreementVersion || '1.0'
  const privacyVersion = settings.privacyPolicyVersion || '1.0'
  const now = db.serverDate()
  const user = await getOrCreateUser(OPENID, now, agreementVersion, privacyVersion)

  try {
    const checkRes = await cloud.openapi.security.msgSecCheck({ content: [proposedName, proposedAbbr].join(' ') })
    if (checkRes.result && checkRes.result.suggest === 'risky') {
      return fail('CONTENT_UNSAFE', '课题信息包含违规内容')
    }
  } catch (err) {
    return fail('CONTENT_CHECK_FAILED', '课题信息内容安全校验失败，请稍后重试')
  }

  const existing = await db.collection('project_applications').where({ userId: user._id, status: 'pending' }).limit(1).get()
  if (existing.data.length > 0) return fail('DUPLICATE', '已有待审核课题申请')

  const res = await db.collection('project_applications').add({
    data: {
      userId: user._id,
      proposedName, proposedAbbr,
      status: 'pending',
      reviewedBy: '', reviewReason: '',
      finalName: '', finalAbbr: '',
      approvedProjectId: '',
      userConfirmedAt: null,
      createdAt: now, updatedAt: now,
    },
  })
  await db.collection('users').doc(user._id).update({
    data: {
      agreementVersion,
      agreementAcceptedAt: now,
      privacyVersion,
      privacyAcceptedAt: now,
      updatedAt: now,
    },
  })
  return ok({ applicationId: res._id, status: 'pending' })
}
