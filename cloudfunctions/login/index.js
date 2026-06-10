const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const users = db.collection('users')
  const existing = await users.where({ openid: OPENID }).limit(1).get()

  if (existing.data.length === 0) {
    return ok({ identified: false, user: null })
  }

  const user = existing.data[0]

  const settingsRes = await db.collection('settings').doc('global').get()
  const settings = settingsRes.data || {}
  const currentAgreement = settings.serviceAgreementVersion || '1.0'
  const currentPrivacy = settings.privacyPolicyVersion || '1.0'
  const needsLegalAcceptance = (user.agreementVersion || '') !== currentAgreement || (user.privacyVersion || '') !== currentPrivacy

  await users.doc(user._id).update({
    data: {
      lastLoginAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  })

  const whitelist = {
    _id: user._id,
    role: user.role,
    accountStatus: user.accountStatus || 'active',
    registrationStatus: user.registrationStatus,
    name: user.name,
    projectId: user.projectId || '',
    projectName: user.projectName || '',
    projectAbbr: user.projectAbbr || '',
    agreementVersion: user.agreementVersion || '',
    privacyVersion: user.privacyVersion || '',
  }

  return ok({
    identified: true,
    user: whitelist,
    needsLegalAcceptance,
    currentAgreementVersion: currentAgreement,
    currentPrivacyVersion: currentPrivacy,
  })
}
