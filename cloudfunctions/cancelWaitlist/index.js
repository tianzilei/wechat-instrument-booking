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
  const ref = db.collection('waitlists').doc(event.waitlistId)
  const waitlist = (await ref.get()).data
  if (!waitlist || waitlist.openid !== OPENID) return fail('PERMISSION_DENIED', '无权限操作')
  await ref.update({ data: { status: 'cancelled', updatedAt: db.serverDate() } })
  return ok({ waitlistId: event.waitlistId, status: 'cancelled' })
}
