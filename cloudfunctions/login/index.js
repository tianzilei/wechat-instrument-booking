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
    const now = db.serverDate()
    const res = await users.add({
      data: {
        openid: OPENID,
        role: 'user',
        registrationStatus: 'unsubmitted',
        accountStatus: 'active',
        name: '',
        projectId: '',
        projectName: '',
        projectAbbr: '',
        agreementVersion: '',
        agreementAcceptedAt: null,
        privacyVersion: '',
        privacyAcceptedAt: null,
        rejectReason: '',
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
      },
    })
    return ok({
      identified: true,
      user: {
        _id: res._id,
        role: 'user',
        accountStatus: 'active',
        registrationStatus: 'unsubmitted',
        name: '',
        projectId: '',
        projectName: '',
        projectAbbr: '',
        agreementVersion: '',
        privacyVersion: '',
      },
      needsLegalAcceptance: true,
    })
  }

  const user = existing.data[0]

  let settings = {}
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    settings = settingsRes.data || {}
  } catch (err) {
    settings = {}
  }
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
