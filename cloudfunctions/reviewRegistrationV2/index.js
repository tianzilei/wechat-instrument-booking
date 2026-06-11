const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

  if (!event.applicationId || !['approve', 'reject'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')
  const ref = db.collection('registration_applications').doc(event.applicationId)
  const application = (await ref.get()).data
  if (!application || application.status !== 'pending') return fail('STATE_CHANGED', '申请状态已变化')

  const now = db.serverDate()
  if (event.action === 'reject') {
    if (event.reason) {
      try {
        const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
        if (checkRes.result && checkRes.result.suggest === 'risky') {
          return fail('CONTENT_UNSAFE', '拒绝原因包含违规内容')
        }
      } catch (err) {
        console.warn('msgSecCheck unavailable, proceeding:', err.errCode || err.message)
      }
    }
    await ref.update({ data: { status: 'rejected', reviewReason: event.reason || '', reviewedBy: admin._id, reviewedAt: now, updatedAt: now } })
    await db.collection('review_logs').add({
      data: { targetType: 'registration', targetId: event.applicationId, action: 'reject', reason: event.reason || '', reviewerId: admin._id, createdAt: now },
    })
    return ok({ applicationId: event.applicationId, status: 'rejected' })
  }

  await ref.update({ data: { status: 'approved', reviewedBy: admin._id, reviewedAt: now, updatedAt: now } })

  await db.collection('users').doc(application.userId).update({
    data: {
      name: application.nameSnapshot,
      projectId: application.projectId,
      projectName: application.projectNameSnapshot || '',
      projectAbbr: application.projectAbbrSnapshot || '',
      registrationStatus: 'approved',
      agreementVersion: application.agreementVersion,
      privacyVersion: application.privacyVersion,
      updatedAt: now,
    },
  })

  await db.collection('review_logs').add({
    data: { targetType: 'registration', targetId: event.applicationId, action: 'approve', reason: '', reviewerId: admin._id, createdAt: now },
  })

  return ok({ applicationId: event.applicationId, status: 'approved' })
}
