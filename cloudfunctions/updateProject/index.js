const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const PAGE_SIZE = 100

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

async function fetchAllUsersByProjectId(projectId) {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection('users').where({ projectId })
      .field({ _id: true })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    items.push(...batch.data)
    if (batch.data.length < PAGE_SIZE) {
      hasMore = false
    } else {
      skip += batch.data.length
    }
  }
  return items
}

async function syncProjectDisplayCaches(projectId) {
  let hasMore = true
  while (hasMore) {
    const res = await cloud.callFunction({
      name: 'syncProjectDisplayCaches',
      data: { projectId },
    })
    const result = res.result || {}
    const data = result.data || {}
    hasMore = !!data.hasMore && (data.synced || 0) > 0
  }
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
  let renamed = false
  let nextName = project.name
  let nextAbbr = project.abbr

  if (event.name !== undefined || event.abbr !== undefined) {
    const newName = event.name === undefined ? project.name : String(event.name).trim()
    const newAbbr = event.abbr === undefined ? project.abbr : String(event.abbr).trim()
    if (!newName || !newAbbr) return fail('INVALID_PARAMS', '课题名称和缩写不能为空')
    if (event.abbr !== undefined && newAbbr !== project.abbr) {
      const dup = await db.collection('projects').where({ abbr: newAbbr, _id: db.command.neq(event.projectId) }).limit(1).get()
      if (dup.data.length > 0) return fail('DUPLICATE', '课题缩写已存在')
    }
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: [newName, newAbbr].join(' ') })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '课题信息包含违规内容')
      }
    } catch (err) {
      return fail('CONTENT_CHECK_FAILED', '课题信息内容安全校验失败，请稍后重试')
    }
    data.name = newName
    data.abbr = newAbbr
    data.normalizedName = newName.replace(/\s+/g, '').toLowerCase()
    data.normalizedAbbr = newAbbr.replace(/\s+/g, '').toLowerCase()
    data.displayVersion = db.command.inc(1)
    renamed = newName !== project.name || newAbbr !== project.abbr
    nextName = newName
    nextAbbr = newAbbr
  }

  if (event.status && ['active', 'inactive'].includes(event.status)) {
    data.status = event.status
    if (event.status === 'inactive') data.inactiveReason = event.reason || ''
  }

  await ref.update({ data })

  if (renamed) {
    const members = await fetchAllUsersByProjectId(event.projectId)
    await Promise.all(members.map((member) => db.collection('users').doc(member._id).update({
      data: {
        projectName: nextName,
        projectAbbr: nextAbbr,
        updatedAt: db.serverDate(),
      },
    })))
    await syncProjectDisplayCaches(event.projectId)
  }

  return ok({ updated: true })
}
