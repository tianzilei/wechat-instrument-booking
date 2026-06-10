const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()

  // Validate required fields
  const requiredFields = ['name', 'projectName', 'projectAbbr']
  const missing = requiredFields.find((field) => !event[field] || typeof event[field] !== 'string' || event[field].trim() === '')
  if (missing) return fail('INVALID_PARAMS', '请完整填写申请信息')

  // Validate agreement checkbox
  if (event.agreed !== true) return fail('LEGAL_ACCEPTANCE_REQUIRED', '请先同意用户协议和隐私政策')

  // Content safety check
  try {
    const textToCheck = [event.name, event.projectName, event.projectAbbr].filter(Boolean).join(' ')
    if (textToCheck) {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: textToCheck })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '输入内容包含违规信息，请修改后重试')
      }
    }
  } catch (err) {
    // If security API fails, log error code only (not content) and continue
    console.error('msgSecCheck error:', err.errCode || err.message)
  }

  const users = db.collection('users')
  const now = db.serverDate()
  const existing = await users.where({ openid: OPENID }).limit(1).get()
  if (existing.data.length === 0) {
    const res = await users.add({
      data: {
        openid: OPENID,
        role: 'user',
        registrationStatus: 'pending',
        name: event.name.trim(),
        projectName: event.projectName.trim(),
        projectAbbr: event.projectAbbr.trim(),
        agreementVersion: '1.0',
        agreementAcceptedAt: now,
        privacyVersion: '1.0',
        privacyAcceptedAt: now,
        rejectReason: '',
        createdAt: now,
        updatedAt: now,
      },
    })
    return ok({ userId: res._id, registrationStatus: 'pending' })
  }

  const user = existing.data[0]
  if (user.registrationStatus === 'approved') return fail('STATE_CHANGED', '注册已通过，无需重复提交')

  await users.doc(user._id).update({
    data: {
      registrationStatus: 'pending',
      name: event.name.trim(),
      projectName: event.projectName.trim(),
      projectAbbr: event.projectAbbr.trim(),
      agreementVersion: '1.0',
      agreementAcceptedAt: now,
      privacyVersion: '1.0',
      privacyAcceptedAt: now,
      rejectReason: '',
      updatedAt: now,
    },
  })

  return ok({ userId: user._id, registrationStatus: 'pending' })
}
