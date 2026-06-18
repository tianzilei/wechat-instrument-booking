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

async function fetchAllUserBookingsByQuery(where, orderField) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection('bookings').where(where)
      .field({
        _id: true,
        userId: true,
        projectAbbrDisplayCache: true,
        projectAbbr: true,
        firstStartAt: true,
        lastEndAt: true,
        startAt: true,
        endAt: true,
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
      .orderBy(orderField, 'desc')
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

async function fetchAllUserBookings(userId, statusFilter) {
  const [v2Items, legacyItems] = await Promise.all([
    fetchAllUserBookingsByQuery({
      userId,
      ...statusFilter,
      firstStartAt: _.exists(true),
    }, 'firstStartAt'),
    fetchAllUserBookingsByQuery({
      userId,
      ...statusFilter,
      startAt: _.exists(true),
      firstStartAt: _.exists(false),
    }, 'startAt'),
  ])
  return [...v2Items, ...legacyItems].sort((left, right) => {
    const leftStartAt = new Date(left.firstStartAt || left.startAt).getTime()
    const rightStartAt = new Date(right.firstStartAt || right.startAt).getTime()
    return rightStartAt - leftStartAt
  })
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
    startAt: item.firstStartAt || item.startAt,
    endAt: item.lastEndAt || item.endAt,
    projectAbbr: item.projectAbbrDisplayCache || item.projectAbbr || '',
  }))

  return ok({ items })
}
