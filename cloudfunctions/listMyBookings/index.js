const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 100

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function fetchAllUserBookings(userId, statusFilter) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection('bookings').where({
      userId,
      ...statusFilter,
    })
      .field({
        _id: true,
        userId: true,
        projectAbbrDisplayCache: true,
        firstStartAt: true,
        lastEndAt: true,
        segments: true,
        durationHours: true,
        remark: true,
        status: true,
        bookingType: true,
        specialReasons: true,
        reviewReason: true,
        cancellationNote: true,
        createdAt: true,
        updatedAt: true,
      })
      .orderBy('firstStartAt', 'desc')
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).field({ _id: true }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  let statusFilter = {}
  if (event.status === 'upcoming') statusFilter = { status: _.in(['confirmed', 'pending_review']) }
  if (event.status === 'pending') statusFilter = { status: _.in(['pending_review', 'cancel_pending']) }
  if (event.status === 'cancelled') statusFilter = { status: 'cancelled' }
  const bookings = await fetchAllUserBookings(user._id, statusFilter)
  const items = bookings.map((item) => ({
    ...item,
    startAt: item.firstStartAt,
    endAt: item.lastEndAt,
    projectAbbr: item.projectAbbrDisplayCache || '',
  }))

  return ok({ items })
}
