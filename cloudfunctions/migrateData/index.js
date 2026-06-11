const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

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

  let settings = null
  try {
    const settingsRes = await db.collection('settings').doc('global').get()
    settings = settingsRes.data
  } catch (err) {}
  if (settings && settings.processedRulesVersion >= settings.rulesVersion) {
    return fail('ALREADY_MIGRATED', '数据已是最新版本，无需迁移')
  }

  const results = {}
  const now = db.serverDate()

  const usersRes = await db.collection('users').where({
    phone: _.exists(true),
  }).limit(500).get()
  results.usersWithDeprecated = usersRes.data.length
  for (const u of usersRes.data) {
    await db.collection('users').doc(u._id).update({
      data: {
        phone: _.remove(),
        email: _.remove(),
        studentId: _.remove(),
        college: _.remove(),
        supervisor: _.remove(),
        registrationStatus: 'unsubmitted',
        agreementVersion: '',
        privacyVersion: '',
        updatedAt: now,
      },
    })
  }

  const futureBookings = await db.collection('bookings').where({
    status: _.in(['pending_review', 'confirmed', 'cancel_pending']),
  }).limit(500).get()
  results.futureBookingsCancelled = futureBookings.data.length
  for (const b of futureBookings.data) {
    await db.collection('bookings').doc(b._id).update({
      data: { status: 'cancelled', cancellationNote: 'v2_migration', updatedAt: now },
    })
  }

  const activeWaitlists = await db.collection('waitlists').where({
    status: _.nin(['cancelled', 'expired']),
  }).limit(500).get()
  results.waitlistsCancelled = activeWaitlists.data.length
  for (const w of activeWaitlists.data) {
    await db.collection('waitlists').doc(w._id).update({
      data: { status: 'cancelled', updatedAt: now },
    })
  }

  const historyBookings = await db.collection('bookings').where({
    status: _.nin(['pending_review', 'confirmed', 'cancel_pending']),
  }).limit(200).get()
  results.historyAnonymized = historyBookings.data.length
  for (const b of historyBookings.data) {
    await db.collection('bookings').doc(b._id).update({
      data: {
        userId: '',
        projectId: '',
        projectAbbrDisplayCache: '',
        remark: '',
        reviewReason: '',
        cancellationNote: '',
        userName: '',
        college: '',
        updatedAt: now,
      },
    })
  }

  await db.collection('settings').doc('global').set({
    data: {
      _id: 'global',
      timezone: 'Asia/Shanghai',
      openStartHour: 9,
      openEndHour: 18,
      maxAdvanceDays: 7,
      rulesVersion: 1,
      processedRulesVersion: 1,
      serviceMode: 'normal',
      serviceAgreementVersion: '1.0',
      privacyPolicyVersion: '1.0',
      updatedAt: now,
    },
  })

  await db.collection('review_logs').add({
    data: {
      targetType: 'system',
      targetId: 'migration',
      action: 'v2_migration',
      reason: JSON.stringify(results),
      reviewerId: admin._id,
      createdAt: now,
    },
  })

  return ok(results)
}
