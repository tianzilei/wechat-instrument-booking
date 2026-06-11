const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

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
    .where({ status: _.in(['pending_review', 'rule_review_pending']) })
    .field({
      _id: true,
      userId: true,
      projectAbbrDisplayCache: true,
      firstStartAt: true,
      lastEndAt: true,
      segments: true,
      durationHours: true,
      status: true,
      bookingType: true,
      specialReasons: true,
      remark: true,
      createdAt: true,
    })
    .orderBy('createdAt', 'asc')
    .limit(100)
    .get()

  const items = await Promise.all(res.data.map(async (item) => {
    let userName = ''
    if (item.userId) {
      try {
        const userRes = await db.collection('users').doc(item.userId).field({ name: true }).get()
        if (userRes.data) userName = userRes.data.name || ''
      } catch (err) {}
    }
    return {
      ...item,
      startAt: item.firstStartAt,
      endAt: item.lastEndAt,
      projectAbbr: item.projectAbbrDisplayCache || '',
      userName,
    }
  }))

  return ok({ items })
}
