const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

  const data = { updatedAt: db.serverDate() }
  const fields = ['openStartHour', 'openEndHour', 'maxAdvanceDays', 'serviceMode', 'serviceAgreementVersion', 'privacyPolicyVersion']
  fields.forEach((f) => {
    if (event[f] !== undefined) data[f] = event[f]
  })
  if (event.openStartHour !== undefined) {
    data.rulesVersion = db.command.inc(1)
  }

  const ref = db.collection('settings').doc('global')
  const existing = await ref.get()
  if (existing.data) {
    await ref.update({ data })
  } else {
    await db.collection('settings').add({
      data: { _id: 'global', timezone: 'Asia/Shanghai', openStartHour: 9, openEndHour: 18, maxAdvanceDays: 7, rulesVersion: 1, serviceMode: 'normal', serviceAgreementVersion: '1.0', privacyPolicyVersion: '1.0', ...data },
    })
  }
  return ok({ updated: true })
}
