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
  const startAt = new Date(event.startAt)
  const endAt = new Date(event.endAt)
  if (!(startAt < endAt)) return fail('INVALID_PARAMS', '时间参数错误')

  if (event.reason) {
    if (event.reason.length > 500) return fail('INVALID_PARAMS', '维护原因不超过 500 字')
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '维护说明包含违规信息，请修改后重试')
      }
    } catch (err) {
      console.warn('msgSecCheck unavailable, proceeding:', err.errCode || err.message)
    }
  }

  const activeStatuses = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming']
  let allConflicts = []
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const batch = await db.collection('bookings').where({
      status: _.in(activeStatuses),
      firstStartAt: _.lt(endAt),
      lastEndAt: _.gt(startAt),
    }).skip(skip).limit(1000).get()
    allConflicts = allConflicts.concat(batch.data)
    if (batch.data.length < 1000) hasMore = false
    else skip += batch.data.length
  }
  const cancelledBookingIds = allConflicts.map((item) => item._id)
  const now = db.serverDate()
  const addRes = await db.collection('maintenance_slots').add({
    data: {
      startAt,
      endAt,
      reason: event.reason || '',
      createdBy: admin._id,
      cancelledBookingIds,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  })

  await Promise.all(cancelledBookingIds.map((bookingId) => db.collection('bookings').doc(bookingId).update({
    data: {
      status: 'cancelled',
      cancellationNote: 'maintenance_cancelled',
      updatedAt: now,
    },
  })))

  await db.collection('review_logs').add({
    data: { targetType: 'maintenance', targetId: addRes._id, action: 'create', reason: event.reason || '', reviewerId: admin._id, createdAt: now },
  })

  return ok({ maintenanceId: addRes._id, cancelledBookingIds })
}
