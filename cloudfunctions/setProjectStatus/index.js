const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const PAGE_SIZE = 100
const IN_QUERY_SIZE = 100

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

async function fetchAll(collectionName, where) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection(collectionName).where(where).skip(skip).limit(PAGE_SIZE).get()
    items.push(...batch.data)
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

function chunk(items, size) {
  const batches = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

function isFutureActiveSegment(segment, currentTime) {
  return (segment.state || 'active') === 'active' && new Date(segment.startAt) > currentTime
}

function summarizeActiveSegments(segments) {
  const activeSegments = (segments || []).filter((segment) => (segment.state || 'active') === 'active')
  if (activeSegments.length === 0) return null
  return {
    firstStartAt: activeSegments[0].startAt,
    lastEndAt: activeSegments[activeSegments.length - 1].endAt,
    durationHours: activeSegments.reduce((sum, segment) => sum + ((new Date(segment.endAt) - new Date(segment.startAt)) / 3600000), 0),
  }
}

function buildFutureActiveSegmentCancellationUpdate(booking, nowServer, reasonCode) {
  const currentTime = new Date()
  const segments = Array.isArray(booking.segments) ? booking.segments : []
  if (segments.length > 0) {
    let changed = false
    const nextSegments = segments.map((segment) => {
      if (!isFutureActiveSegment(segment, currentTime)) return segment
      changed = true
      return {
        ...segment,
        state: 'cancelled',
        cancelledAt: nowServer,
        cancelReasonCode: reasonCode,
      }
    })
    if (!changed) return null
    const remainingSummary = summarizeActiveSegments(nextSegments)
    const updateData = {
      status: 'cancelled',
      segments: nextSegments,
      cancellationNote: reasonCode,
      updatedAt: nowServer,
    }
    Object.assign(updateData, remainingSummary || {})
    return updateData
  }

  const startAt = new Date(booking.firstStartAt || booking.startAt)
  if (startAt <= currentTime) return null
  return {
    status: 'cancelled',
    cancellationNote: reasonCode,
    updatedAt: nowServer,
  }
}

async function fetchWaitlistsByUserIds(userIds) {
  const items = []
  for (const batchIds of chunk(userIds, IN_QUERY_SIZE)) {
    if (batchIds.length === 0) continue
    let skip = 0
    let hasMore = true
    while (hasMore) {
      const batch = await db.collection('waitlists').where({
        userId: _.in(batchIds),
        status: _.nin(['cancelled', 'expired', 'converted']),
      }).skip(skip).limit(PAGE_SIZE).get()
      items.push(...batch.data)
      if (batch.data.length < PAGE_SIZE) {
        hasMore = false
      } else {
        skip += batch.data.length
      }
    }
  }
  return items
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')

  if (!event.projectId || !['active', 'inactive'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')

  const projectRef = db.collection('projects').doc(event.projectId)
  const project = (await projectRef.get()).data
  if (!project) return fail('NOT_FOUND', '课题不存在')

  const now = db.serverDate()
  const results = { cancelledBookings: 0, cancelledWaitlists: 0, affectedUsers: 0 }

  if (event.action === 'inactive') {
    if (event.reason) {
      try {
        const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
        if (checkRes.result && checkRes.result.suggest === 'risky') {
          return fail('CONTENT_UNSAFE', '停用原因包含违规信息')
        }
      } catch (err) {
        return fail('CONTENT_CHECK_FAILED', '停用原因内容安全校验失败，请稍后重试')
      }
    }

    const members = await fetchAll('users', {
      projectId: event.projectId,
      accountStatus: 'active',
    })
    await Promise.all(members.map((m) => db.collection('users').doc(m._id).update({
      data: { accountStatus: 'project_reassignment_required', updatedAt: now },
    })))
    results.affectedUsers = members.length

    const allProjectMembers = await fetchAll('users', {
      projectId: event.projectId,
    })
    const bookings = await fetchAll('bookings', {
      projectId: event.projectId,
      status: _.in(['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']),
    })
    const bookingUpdates = bookings
      .map((booking) => ({ booking, update: buildFutureActiveSegmentCancellationUpdate(booking, now, 'project_inactive') }))
      .filter((item) => !!item.update)
    await Promise.all(bookingUpdates.map((item) => db.collection('bookings').doc(item.booking._id).update({
      data: item.update,
    })))
    results.cancelledBookings = bookingUpdates.length

    const waitlists = await fetchWaitlistsByUserIds(allProjectMembers.map((member) => member._id))
    await Promise.all(waitlists.map((waitlist) => db.collection('waitlists').doc(waitlist._id).update({
      data: { status: 'cancelled', updatedAt: now },
    })))
    results.cancelledWaitlists = waitlists.length

    await projectRef.update({
      data: { status: 'inactive', inactiveReason: event.reason || '', updatedAt: now },
    })

    await db.collection('review_logs').add({
      data: { targetType: 'project', targetId: event.projectId, action: 'inactive', reason: event.reason || '', reviewerId: admin._id, createdAt: now },
    })
  } else {
    await projectRef.update({ data: { status: 'active', inactiveReason: '', updatedAt: now } })
    await db.collection('review_logs').add({
      data: { targetType: 'project', targetId: event.projectId, action: 'active', reason: '管理员重新启用', reviewerId: admin._id, createdAt: now },
    })
  }

  return ok({ projectId: event.projectId, status: event.action, ...results })
}
