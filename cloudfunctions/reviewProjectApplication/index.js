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
  const ref = db.collection('project_applications').doc(event.applicationId)
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
        return fail('CONTENT_CHECK_FAILED', '拒绝原因内容安全校验失败，请稍后重试')
      }
    }
    await ref.update({ data: { status: 'rejected', reviewReason: event.reason || '', reviewedBy: admin._id, reviewedAt: now, updatedAt: now } })
    await db.collection('review_logs').add({
      data: { targetType: 'project_application', targetId: event.applicationId, action: 'reject', reason: event.reason || '', reviewerId: admin._id, createdAt: now },
    })
    return ok({ applicationId: event.applicationId, status: 'rejected' })
  }

  if (application.approvedProjectId) {
    const approvedProject = (await db.collection('projects').doc(application.approvedProjectId).get()).data
    if (!approvedProject || approvedProject.status !== 'active') return fail('PROJECT_INACTIVE', '课题不可用')
    await ref.update({
      data: {
        status: 'approved',
        finalName: approvedProject.name,
        finalAbbr: approvedProject.abbr,
        reviewedBy: admin._id,
        reviewedAt: now,
        updatedAt: now,
      },
    })
    await db.collection('review_logs').add({
      data: { targetType: 'project_application', targetId: event.applicationId, action: 'approve', reason: '', reviewerId: admin._id, createdAt: now },
    })
    return ok({ applicationId: event.applicationId, status: 'approved', projectId: approvedProject._id })
  }

  if (!event.finalName || !event.finalAbbr) return fail('INVALID_PARAMS', '请填写最终课题名称和缩写')
  const finalName = event.finalName.trim()
  const finalAbbr = event.finalAbbr.trim()

  const dup = await db.collection('projects').where({ abbr: finalAbbr }).limit(1).get()
  if (dup.data.length > 0) return fail('DUPLICATE', '缩写已被占用，请使用已有课题或修改缩写')

  try {
    const checkRes = await cloud.openapi.security.msgSecCheck({ content: [finalName, finalAbbr].join(' ') })
    if (checkRes.result && checkRes.result.suggest === 'risky') {
      return fail('CONTENT_UNSAFE', '课题信息包含违规内容')
    }
  } catch (err) {
    return fail('CONTENT_CHECK_FAILED', '课题信息内容安全校验失败，请稍后重试')
  }

  const normalizedName = finalName.replace(/\s+/g, '').toLowerCase()
  const normalizedAbbr = finalAbbr.replace(/\s+/g, '').toLowerCase()
  const projectRes = await db.collection('projects').add({
    data: {
      name: finalName, abbr: finalAbbr, normalizedName, normalizedAbbr, displayVersion: 1,
      status: 'active', createdBy: admin._id, updatedBy: admin._id,
      createdAt: now, updatedAt: now,
    },
  })
  await ref.update({
    data: {
      status: 'approved', approvedProjectId: projectRes._id,
      finalName, finalAbbr,
      reviewedBy: admin._id, reviewedAt: now, updatedAt: now,
    },
  })
  await db.collection('review_logs').add({
    data: { targetType: 'project_application', targetId: event.applicationId, action: 'approve', reason: '', reviewerId: admin._id, createdAt: now },
  })
  return ok({ applicationId: event.applicationId, status: 'approved', projectId: projectRes._id })
}
