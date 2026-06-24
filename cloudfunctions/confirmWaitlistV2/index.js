const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const ACTIVE_BOOKING_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']
const BOOKING_MUTEX_DOC_ID = 'booking_schedule_mutex'
const PAGE_SIZE = 100

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

function businessError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function isWriteConflictError(err) {
  const text = String((err && (err.errMsg || err.message || err.code)) || '').toLowerCase()
  return text.includes('conflict')
}

async function runWithBookingMutex(holder, callback) {
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transaction = await db.startTransaction()
    try {
      const mutexRef = transaction.collection('system_locks').doc(BOOKING_MUTEX_DOC_ID)
      try {
        await mutexRef.get()
      } catch (err) {}
      await mutexRef.set({
        data: {
          _id: BOOKING_MUTEX_DOC_ID,
          holder,
          updatedAt: db.serverDate(),
        },
      })
      const result = await callback(transaction)
      await transaction.commit()
      return result
    } catch (err) {
      lastErr = err
      try {
        await transaction.rollback()
      } catch (rollbackErr) {}
      if (!isWriteConflictError(err) || attempt === 2) {
        throw err
      }
    }
  }
  throw lastErr || new Error('booking mutex failed')
}

async function fetchAll(collectionRef, where) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await collectionRef.where(where).skip(skip).limit(PAGE_SIZE).get()
    items.push(...batch.data)
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

async function ensureProjectActive(userId, projectId) {
  if (!projectId) return businessError('PROJECT_INACTIVE', '请先绑定可用课题')
  const [projectRes, pendingChangeRes] = await Promise.all([
    db.collection('projects').doc(projectId).field({ status: true }).get(),
    db.collection('project_applications').where({ userId, status: 'pending' }).limit(1).get(),
  ])
  const project = projectRes.data
  if (!project || project.status !== 'active') {
    return businessError('PROJECT_INACTIVE', '课题不可用')
  }
  if (pendingChangeRes.data.length > 0) {
    return businessError('PROJECT_CHANGE_PENDING', '课题变更审核中，暂不可预约')
  }
  return null
}

function anyMaintenanceConflict(segments, maintenanceSlots) {
  for (const segment of segments) {
    const segmentStart = new Date(segment.startAt)
    const segmentEnd = new Date(segment.endAt)
    for (const slot of maintenanceSlots) {
      const slotStart = new Date(slot.startAt)
      const slotEnd = new Date(slot.endAt)
      if (segmentStart < slotEnd && segmentEnd > slotStart) return true
    }
  }
  return false
}

function getWaitlistSegments(waitlist) {
  return waitlist.segments || waitlist.occupiedSegments || [{ startAt: waitlist.startAt, endAt: waitlist.endAt }]
}

function getEarliestStartAt(segments) {
  return segments.reduce((min, segment) => {
    const value = new Date(segment.startAt)
    return value < min ? value : min
  }, new Date(segments[0].startAt))
}

function startOfDay(date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function getWeekStart(date) {
  const value = startOfDay(date)
  const day = value.getDay()
  const diff = day === 0 ? -6 : 1 - day
  value.setDate(value.getDate() + diff)
  return value
}

function isSingleNaturalWeek(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false
  const anchorWeekStart = getWeekStart(segments[0].startAt).getTime()
  return segments.every((segment) => {
    const endPoint = new Date(new Date(segment.endAt).getTime() - 1)
    return getWeekStart(segment.startAt).getTime() === anchorWeekStart
      && getWeekStart(endPoint).getTime() === anchorWeekStart
  })
}

function getComparableSegments(segments) {
  return (segments || [])
    .map((segment) => ({
      startAt: new Date(segment.startAt),
      endAt: new Date(segment.endAt),
    }))
    .filter((segment) => segment.startAt < segment.endAt)
}

function getBookingActiveSegments(booking) {
  if (Array.isArray(booking.segments) && booking.segments.length > 0) {
    return getComparableSegments(
      booking.segments.filter((segment) => (segment.state || 'active') !== 'cancelled')
    )
  }
  return getComparableSegments([{
    startAt: booking.firstStartAt || booking.startAt,
    endAt: booking.lastEndAt || booking.endAt,
  }])
}

function hasSegmentsOverlap(leftSegments, rightSegments) {
  for (const left of leftSegments) {
    for (const right of rightSegments) {
      if (left.startAt < right.endAt && left.endAt > right.startAt) return true
    }
  }
  return false
}

async function triggerWaitlistReconcile(source) {
  try {
    await cloud.callFunction({
      name: 'reconcileWaitlists',
      data: { source },
    })
  } catch (err) {}
}

function buildConflictQueryConditions(segments, projectId) {
  const sharedFilter = { status: _.in(ACTIVE_BOOKING_STATUSES) }
  if (projectId) sharedFilter.projectId = projectId
  const v2Conditions = segments.map((segment) => ({
    ...sharedFilter,
    firstStartAt: _.lt(new Date(segment.endAt)),
    lastEndAt: _.gt(new Date(segment.startAt)),
  }))
  const v1Conditions = segments.map((segment) => ({
    ...sharedFilter,
    startAt: _.lt(new Date(segment.endAt)),
    endAt: _.gt(new Date(segment.startAt)),
  }))
  return [...v2Conditions, ...v1Conditions]
}

async function hasPreciseBookingConflict(segments, projectId) {
  const requestSegments = getComparableSegments(segments)
  const conditions = buildConflictQueryConditions(requestSegments, projectId)
  if (conditions.length === 0) return false
  const query = conditions.length === 1 ? conditions[0] : _.or(conditions)
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const batch = await db.collection('bookings').where(query).field({
      segments: true,
      firstStartAt: true,
      lastEndAt: true,
      startAt: true,
      endAt: true,
    }).skip(skip).limit(PAGE_SIZE).get()
    const conflictFound = batch.data.some((booking) => hasSegmentsOverlap(requestSegments, getBookingActiveSegments(booking)))
    if (conflictFound) return true
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return false
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')
  {
    const projectError = await ensureProjectActive(user._id, user.projectId || '')
    if (projectError) return fail(projectError.code, projectError.message)
  }

  if (!event.waitlistId || !['confirm', 'decline'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')
  const waitlist = (await db.collection('waitlists').doc(event.waitlistId).get()).data
  if (!waitlist || waitlist.userId !== user._id) return fail('PERMISSION_DENIED', '无权限操作')

  if (event.action === 'decline') {
    await db.collection('waitlists').doc(event.waitlistId).update({
      data: { status: 'cancelled', updatedAt: db.serverDate() },
    })
    await triggerWaitlistReconcile('confirmWaitlistV2_decline')
    return ok({ waitlistId: event.waitlistId, status: 'cancelled' })
  }

  if (user.registrationStatus !== 'approved') return fail('REGISTRATION_REQUIRED', '注册审核通过后才能预约')
  if (user.accountStatus && user.accountStatus !== 'active') return fail('ACCOUNT_SUSPENDED', '账号状态异常')
  if (waitlist.status !== 'confirming') return fail('STATE_CHANGED', '候补尚未进入确认状态')
  {
    const segments = getWaitlistSegments(waitlist)
    const earliestStartAt = getEarliestStartAt(segments)
    const confirmDeadlineAt = waitlist.confirmDeadlineAt ? new Date(waitlist.confirmDeadlineAt) : earliestStartAt
    const now = new Date()
    if (confirmDeadlineAt <= now || earliestStartAt <= now) {
      await db.collection('waitlists').doc(event.waitlistId).update({
        data: { status: 'expired', updatedAt: db.serverDate() },
      })
      await triggerWaitlistReconcile('confirmWaitlistV2_expired_precheck')
      return fail('STATE_CHANGED', '候补确认已超时')
    }
  }

  let openStartHour = 9
  let openEndHour = 18
  let serviceMode = 'normal'
  let agreementVersion = '1.0'
  let privacyVersion = '1.0'
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    const settings = settingsRes.data || {}
    openStartHour = settings.openStartHour || 9
    openEndHour = settings.openEndHour || 18
    serviceMode = settings.serviceMode || 'normal'
    agreementVersion = settings.serviceAgreementVersion || '1.0'
    privacyVersion = settings.privacyPolicyVersion || '1.0'
  } catch (err) {}

  if (serviceMode !== 'normal') return fail('SERVICE_UNAVAILABLE', '系统维护中，暂不支持预约')
  if ((user.agreementVersion || '') !== agreementVersion || (user.privacyVersion || '') !== privacyVersion) {
    return fail('LEGAL_ACCEPTANCE_REQUIRED', '请先同意最新协议与隐私政策')
  }

  try {
    const result = await runWithBookingMutex(`waitlist:${event.waitlistId}`, async (transaction) => {
      const latestWaitlistRes = await transaction.collection('waitlists').doc(event.waitlistId).get()
      const latestWaitlist = latestWaitlistRes.data
      if (!latestWaitlist || latestWaitlist.userId !== user._id) {
        throw businessError('PERMISSION_DENIED', '无权限操作')
      }
      if (latestWaitlist.convertedBookingId) {
        return {
          duplicateRequest: true,
          waitlistId: event.waitlistId,
          bookingId: latestWaitlist.convertedBookingId,
        }
      }
      if (latestWaitlist.status !== 'confirming') {
        throw businessError('STATE_CHANGED', '候补尚未进入确认状态')
      }

      const segments = getWaitlistSegments(latestWaitlist)
      if (!isSingleNaturalWeek(segments)) {
        throw businessError('INVALID_SEGMENTS', '所有时段必须位于同一自然周')
      }
      const now = new Date()
      const earliestStartAt = getEarliestStartAt(segments)
      const confirmDeadlineAt = latestWaitlist.confirmDeadlineAt ? new Date(latestWaitlist.confirmDeadlineAt) : earliestStartAt
      if (confirmDeadlineAt <= now || earliestStartAt <= now) {
        await transaction.collection('waitlists').doc(event.waitlistId).update({
          data: {
            status: 'expired',
            updatedAt: db.serverDate(),
          },
        })
        throw businessError('STATE_CHANGED', '候补确认已超时')
      }

      const maintenanceSlots = await fetchAll(transaction.collection('maintenance_slots'), { status: 'active' })
      if (anyMaintenanceConflict(segments, maintenanceSlots)) {
        throw businessError('MAINTENANCE_CONFLICT', '任一时段命中维护')
      }
      if (user.projectId && await checkProjectConflict(segments, user.projectId)) {
        throw businessError('PROJECT_BOOKING_CONFLICT', '该时段已被本课题预约')
      }
      if (await checkConflict(segments)) {
        throw businessError('BOOKING_CONFLICT', '时段已被占用')
      }

      const specialReasons = getSpecialReasons(segments, openStartHour, openEndHour)
      const bookingStatus = specialReasons.length > 0 ? 'pending_review' : 'confirmed'
      const bookingType = specialReasons.length > 0 ? 'special' : 'normal'
      const nowServer = db.serverDate()
      const bookingSegments = segments.map((segment) => ({
        startAt: segment.startAt,
        endAt: segment.endAt,
        state: 'active',
        cancelledAt: null,
        cancelReasonCode: '',
      }))
      const durationHours = segments.reduce((sum, segment) => sum + (new Date(segment.endAt) - new Date(segment.startAt)) / 3600000, 0)

      const bookingRes = await transaction.collection('bookings').add({
        data: {
          userId: user._id,
          projectId: user.projectId || '',
          projectAbbrDisplayCache: user.projectAbbr || '',
          projectDisplayVersion: 1,
          scheduleKey: latestWaitlist.scheduleKey || '',
          segments: bookingSegments,
          firstStartAt: segments[0].startAt,
          lastEndAt: segments[segments.length - 1].endAt,
          durationHours,
          remark: latestWaitlist.remark || '',
          status: bookingStatus,
          previousStatus: '',
          bookingType,
          specialReasons,
          reviewReason: '',
          cancellationNote: '',
          terminationReasonCode: '',
          reviewedBy: '',
          createdAt: nowServer,
          updatedAt: nowServer,
        },
      })

      await transaction.collection('waitlists').doc(event.waitlistId).update({
        data: {
          status: 'converted',
          convertedBookingId: bookingRes._id,
          updatedAt: nowServer,
        },
      })

      return {
        duplicateRequest: false,
        waitlistId: event.waitlistId,
        bookingId: bookingRes._id,
      }
    })

    return ok({
      waitlistId: result.waitlistId,
      status: 'converted',
      bookingId: result.bookingId,
      duplicateRequest: !!result.duplicateRequest,
    })
  } catch (err) {
    if (err && err.code === 'STATE_CHANGED') {
      await triggerWaitlistReconcile('confirmWaitlistV2_state_changed')
    }
    if (err && err.code) return fail(err.code, err.message)
    return fail('SYSTEM_BUSY', '系统繁忙，请稍后重试')
  }
}

async function checkConflict(segments) {
  return hasPreciseBookingConflict(segments, '')
}

async function checkProjectConflict(segments, projectId) {
  return hasPreciseBookingConflict(segments, projectId)
}

function getSpecialReasons(segments, openStartHour, openEndHour) {
  const reasons = new Set()
  for (const s of segments) {
    const start = new Date(s.startAt)
    const endPoint = new Date(new Date(s.endAt).getTime() - 1)
    if (start.getDay() === 0 || start.getDay() === 6 || endPoint.getDay() === 0 || endPoint.getDay() === 6) reasons.add('weekend')
    if (start.getHours() < openStartHour || endPoint.getHours() >= openEndHour) reasons.add('night')
  }
  return [...reasons]
}
