const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

exports.main = async () => {
  const res = await db.collection('settings').doc('global').get()
  const doc = res.data
  return ok(doc ? {
    timezone: doc.timezone || 'Asia/Shanghai',
    openStartHour: doc.openStartHour || 9,
    openEndHour: doc.openEndHour || 18,
    maxAdvanceDays: doc.maxAdvanceDays || 7,
    rulesVersion: doc.rulesVersion || 1,
    serviceMode: doc.serviceMode || 'normal',
    serviceAgreementVersion: doc.serviceAgreementVersion || '1.0',
    privacyPolicyVersion: doc.privacyPolicyVersion || '1.0',
    updatedAt: doc.updatedAt,
  } : {
    timezone: 'Asia/Shanghai',
    openStartHour: 9,
    openEndHour: 18,
    maxAdvanceDays: 7,
    rulesVersion: 1,
    serviceMode: 'normal',
    serviceAgreementVersion: '1.0',
    privacyPolicyVersion: '1.0',
  })
}
