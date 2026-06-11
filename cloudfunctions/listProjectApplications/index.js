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

  const status = event.status || 'pending'
  const res = await db.collection('project_applications')
    .where({ status })
    .field({ _id: true, userId: true, proposedName: true, proposedAbbr: true, status: true, reviewReason: true, createdAt: true })
    .orderBy('createdAt', 'asc')
    .limit(50)
    .get()
  return ok({ items: res.data })
}
