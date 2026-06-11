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
  if (!openid) return false
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin'
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!(await isAdmin(OPENID))) return fail('PERMISSION_DENIED', '无权限操作')
  const res = await db.collection('bookings')
    .where({ status: 'cancel_pending' })
    .field({
      _id: true,
      userId: true,
      projectAbbrDisplayCache: true,
      firstStartAt: true,
      lastEndAt: true,
      segments: true,
      durationHours: true,
      status: true,
      cancellationNote: true,
      createdAt: true,
      updatedAt: true,
    })
    .orderBy('updatedAt', 'asc')
    .limit(100)
    .get()

  const items = res.data.map((item) => ({
    ...item,
    startAt: item.firstStartAt,
    endAt: item.lastEndAt,
    projectAbbr: item.projectAbbrDisplayCache || '',
  }))

  return ok({ items })
}
