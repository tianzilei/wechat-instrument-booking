const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getAdmin(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')

  if (!event.projectId) return fail('INVALID_PARAMS', '参数错误')
  const ref = db.collection('projects').doc(event.projectId)
  const project = (await ref.get()).data
  if (!project) return fail('NOT_FOUND', '课题不存在')

  const now = db.serverDate()
  const data = { updatedAt: now, updatedBy: admin._id }

  if (event.name || event.abbr) {
    const newName = (event.name || project.name).trim()
    const newAbbr = (event.abbr || project.abbr).trim()
    if (event.abbr && newAbbr !== project.abbr) {
      const dup = await db.collection('projects').where({ abbr: newAbbr, _id: db.command.neq(event.projectId) }).limit(1).get()
      if (dup.data.length > 0) return fail('DUPLICATE', '课题缩写已存在')
    }
    if (newName || newAbbr) {
      try {
        const checkRes = await cloud.openapi.security.msgSecCheck({ content: [newName, newAbbr].filter(Boolean).join(' ') })
        if (checkRes.result && checkRes.result.suggest === 'risky') {
          return fail('CONTENT_UNSAFE', '课题信息包含违规内容')
        }
      } catch (err) {
        console.error('msgSecCheck error:', err.errCode || err.message)
      }
    }
    data.name = newName
    data.abbr = newAbbr
    data.normalizedName = newName.replace(/\s+/g, '').toLowerCase()
    data.normalizedAbbr = newAbbr.replace(/\s+/g, '').toLowerCase()
    data.displayVersion = db.command.inc(1)
  }

  if (event.status && ['active', 'inactive'].includes(event.status)) {
    data.status = event.status
    if (event.status === 'inactive') data.inactiveReason = event.reason || ''
  }

  await ref.update({ data })
  return ok({ updated: true })
}
