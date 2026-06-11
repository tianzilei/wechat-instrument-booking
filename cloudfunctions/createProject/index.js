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

  const name = (event.name || '').trim()
  const abbr = (event.abbr || '').trim()
  if (!name || !abbr) return fail('INVALID_PARAMS', '课题名称和缩写不能为空')

  const dup = await db.collection('projects').where({ abbr }).limit(1).get()
  if (dup.data.length > 0) return fail('DUPLICATE', '课题缩写已存在')

  const now = db.serverDate()
  const normalizedName = name.replace(/\s+/g, '').toLowerCase()
  const normalizedAbbr = abbr.replace(/\s+/g, '').toLowerCase()

  const contentCheck = [name, abbr].filter(Boolean).join(' ')
  try {
    const checkRes = await cloud.openapi.security.msgSecCheck({ content: contentCheck })
    if (checkRes.result && checkRes.result.suggest === 'risky') {
      return fail('CONTENT_UNSAFE', '课题信息包含违规内容')
    }
  } catch (err) {
    console.warn('msgSecCheck unavailable, proceeding:', err.errCode || err.message)
  }

  const res = await db.collection('projects').add({
    data: {
      name, abbr, normalizedName, normalizedAbbr, displayVersion: 1,
      status: 'active', createdBy: admin._id, updatedBy: admin._id,
      createdAt: now, updatedAt: now,
    },
  })
  return ok({ projectId: res._id })
}
