const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }

exports.main = async () => {
  const settings = (await db.collection('settings').doc('global').get()).data || {}
  return ok({
    serviceAgreementVersion: settings.serviceAgreementVersion || '1.0',
    privacyPolicyVersion: settings.privacyPolicyVersion || '1.0',
    serviceAgreementTitle: '用户服务协议',
    privacyPolicyTitle: '隐私政策',
    lastUpdated: settings.updatedAt || null,
  })
}
