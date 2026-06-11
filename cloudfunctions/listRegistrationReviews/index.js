const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function isAdmin(openid) {
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin'
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!(await isAdmin(OPENID))) return fail('PERMISSION_DENIED', '无权限操作')

  const res = await db.collection('registration_applications')
    .where({ status: 'pending' })
    .field({
      _id: true,
      userId: true,
      nameSnapshot: true,
      projectId: true,
      projectNameSnapshot: true,
      projectAbbrSnapshot: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    })
    .orderBy('createdAt', 'asc')
    .limit(100)
    .get()

  const items = res.data.map((item) => ({
    _id: item._id,
    userId: item.userId,
    nameSnapshot: item.nameSnapshot,
    projectId: item.projectId,
    projectName: item.projectNameSnapshot || '',
    projectAbbr: item.projectAbbrSnapshot || '',
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))

  return ok({ items })
}
