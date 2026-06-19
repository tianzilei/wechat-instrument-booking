const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const DEFAULT_SETTINGS = {
  timezone: 'Asia/Shanghai',
  openStartHour: 9,
  openEndHour: 18,
  maxAdvanceDays: 7,
  rulesVersion: 1,
  processedRulesVersion: 1,
  serviceMode: 'normal',
  serviceAgreementVersion: '1.0',
  privacyPolicyVersion: '1.0',
}
const ALLOWED_SERVICE_MODES = ['normal', 'maintenance']

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')

  let existing = null
  try {
    const existingRes = await db.collection('settings').doc('global').get()
    existing = existingRes.data || null
  } catch (err) {}
  const current = existing ? { ...DEFAULT_SETTINGS, ...existing } : { ...DEFAULT_SETTINGS }

  const data = { updatedAt: db.serverDate() }

  if (event.openStartHour !== undefined) {
    if (!Number.isInteger(event.openStartHour) || event.openStartHour < 0 || event.openStartHour > 23) {
      return fail('INVALID_PARAMS', '开放开始时间必须是 0-23 的整数')
    }
    data.openStartHour = event.openStartHour
  }
  if (event.openEndHour !== undefined) {
    if (!Number.isInteger(event.openEndHour) || event.openEndHour < 1 || event.openEndHour > 24) {
      return fail('INVALID_PARAMS', '开放结束时间必须是 1-24 的整数')
    }
    data.openEndHour = event.openEndHour
  }
  const nextOpenStartHour = data.openStartHour !== undefined ? data.openStartHour : current.openStartHour
  const nextOpenEndHour = data.openEndHour !== undefined ? data.openEndHour : current.openEndHour
  if (nextOpenStartHour >= nextOpenEndHour) {
    return fail('INVALID_PARAMS', '开放时间范围无效')
  }

  if (event.maxAdvanceDays !== undefined) {
    if (!Number.isInteger(event.maxAdvanceDays) || event.maxAdvanceDays < 1 || event.maxAdvanceDays > 365) {
      return fail('INVALID_PARAMS', '最大提前天数必须是 1-365 的整数')
    }
    data.maxAdvanceDays = event.maxAdvanceDays
  }

  if (event.serviceMode !== undefined) {
    if (!ALLOWED_SERVICE_MODES.includes(event.serviceMode)) {
      return fail('INVALID_PARAMS', '服务模式无效')
    }
    data.serviceMode = event.serviceMode
  }

  if (event.serviceAgreementVersion !== undefined) {
    const serviceAgreementVersion = String(event.serviceAgreementVersion).trim()
    if (!serviceAgreementVersion) return fail('INVALID_PARAMS', '服务协议版本不能为空')
    data.serviceAgreementVersion = serviceAgreementVersion
  }

  if (event.privacyPolicyVersion !== undefined) {
    const privacyPolicyVersion = String(event.privacyPolicyVersion).trim()
    if (!privacyPolicyVersion) return fail('INVALID_PARAMS', '隐私政策版本不能为空')
    data.privacyPolicyVersion = privacyPolicyVersion
  }

  const workingHoursChanged = nextOpenStartHour !== current.openStartHour || nextOpenEndHour !== current.openEndHour
  if (workingHoursChanged) {
    data.rulesVersion = (current.rulesVersion || 1) + 1
  }

  const ref = db.collection('settings').doc('global')
  if (existing) {
    await ref.update({ data })
  } else {
    await db.collection('settings').add({
      data: { _id: 'global', ...current, ...data },
    })
  }
  return ok({ updated: true })
}
