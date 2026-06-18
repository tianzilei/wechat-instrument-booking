const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user) return fail('AUTH_REQUIRED', '请先登录')

  const proposedName = (event.proposedName || '').trim()
  const proposedAbbr = (event.proposedAbbr || '').trim()
  if (!proposedName || !proposedAbbr) return fail('INVALID_PARAMS', '课题名称和缩写不能为空')

  try {
    const checkRes = await cloud.openapi.security.msgSecCheck({ content: [proposedName, proposedAbbr].join(' ') })
    if (checkRes.result && checkRes.result.suggest === 'risky') {
      return fail('CONTENT_UNSAFE', '课题信息包含违规内容')
    }
  } catch (err) {
    return fail('CONTENT_CHECK_FAILED', '课题信息内容安全校验失败，请稍后重试')
  }

  const existing = await db.collection('project_applications').where({ userId: user._id, status: 'pending' }).limit(1).get()
  if (existing.data.length > 0) return fail('DUPLICATE', '已有待审核课题申请')

  const now = db.serverDate()
  const res = await db.collection('project_applications').add({
    data: {
      userId: user._id,
      proposedName, proposedAbbr,
      status: 'pending',
      reviewedBy: '', reviewReason: '',
      finalName: '', finalAbbr: '',
      approvedProjectId: '',
      userConfirmedAt: null,
      createdAt: now, updatedAt: now,
    },
  })
  return ok({ applicationId: res._id, status: 'pending' })
}
