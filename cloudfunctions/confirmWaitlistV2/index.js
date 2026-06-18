const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const ACTIVE_BOOKING_STATUSES = ['pending_review', 'confirmed', 'cancel_pending', 'waitlist_confirming', 'rule_review_pending']
const BOOKING_MUTEX_DOC_ID = 'booking_schedule_mutex'

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
      await mutexRef.get()
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  if (!event.waitlistId || !['confirm', 'decline'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')
  const waitlist = (await db.collection('waitlists').doc(event.waitlistId).get()).data
  if (!waitlist || waitlist.userId !== user._id) return fail('PERMISSION_DENIED', '无权限操作')

  if (event.action === 'decline') {
    await db.collection('waitlists').doc(event.waitlistId).update({
      data: { status: 'cancelled', updatedAt: db.serverDate() },
    })
    return ok({ waitlistId: event.waitlistId, status: 'cancelled' })
  }

  if (user.registrationStatus !== 'approved') return fail('REGISTRATION_REQUIRED', '注册审核通过后才能预约')
  if (user.accountStatus && user.accountStatus !== 'active') return fail('ACCOUNT_SUSPENDED', '账号状态异常')
  if (waitlist.status !== 'confirming') return fail('STATE_CHANGED', '候补尚未进入确认状态')

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

      const segments = latestWaitlist.segments || latestWaitlist.occupiedSegments || [{ startAt: latestWaitlist.startAt, endAt: latestWaitlist.endAt }]
      const now = new Date()
      for (const segment of segments) {
        const startAt = new Date(segment.startAt)
        if (startAt <= now) throw businessError('INVALID_SEGMENTS', '时段已过期')
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
    if (err && err.code) return fail(err.code, err.message)
    return fail('SYSTEM_BUSY', '系统繁忙，请稍后重试')
  }
}

async function checkConflict(segments) {
  const conditions = segments.map((s) => ({
    status: _.in(ACTIVE_BOOKING_STATUSES),
    firstStartAt: _.lt(new Date(s.endAt)),
    lastEndAt: _.gt(new Date(s.startAt)),
  }))
  if (conditions.length === 0) return false
  if (conditions.length === 1) {
    const res = await db.collection('bookings').where(conditions[0]).limit(1).get()
    return res.data.length > 0
  }
  const res = await db.collection('bookings').where(_.or(conditions)).limit(1).get()
  return res.data.length > 0
}

async function checkProjectConflict(segments, projectId) {
  const conditions = segments.map((s) => ({
    status: _.in(ACTIVE_BOOKING_STATUSES),
    projectId,
    firstStartAt: _.lt(new Date(s.endAt)),
    lastEndAt: _.gt(new Date(s.startAt)),
  }))
  if (conditions.length === 0) return false
  if (conditions.length === 1) {
    const res = await db.collection('bookings').where(conditions[0]).limit(1).get()
    return res.data.length > 0
  }
  const res = await db.collection('bookings').where(_.or(conditions)).limit(1).get()
  return res.data.length > 0
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
