const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  const settingsRes = await db.collection('settings').doc('global').get()
  const settings = settingsRes.data || {}
  const now = db.serverDate()

  await db.collection('users').doc(user._id).update({
    data: {
      agreementVersion: settings.serviceAgreementVersion || '1.0',
      agreementAcceptedAt: now,
      privacyVersion: settings.privacyPolicyVersion || '1.0',
      privacyAcceptedAt: now,
      updatedAt: now,
    },
  })

  return ok({ accepted: true, agreementVersion: settings.serviceAgreementVersion || '1.0', privacyVersion: settings.privacyPolicyVersion || '1.0' })
}
