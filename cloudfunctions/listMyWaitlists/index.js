const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const PAGE_SIZE = 100

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function fetchAllWaitlists(userId) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection('waitlists')
      .where({ userId })
      .field({
        _id: true,
        userId: true,
        scheduleKey: true,
        startAt: true,
        endAt: true,
        segments: true,
        occupiedSegments: true,
        remark: true,
        status: true,
        queueOrder: true,
        confirmDeadlineAt: true,
        convertedBookingId: true,
        createdAt: true,
        updatedAt: true,
      })
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    items.push(...batch.data)
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  const items = await fetchAllWaitlists(user._id)
  return ok({ items })
}
