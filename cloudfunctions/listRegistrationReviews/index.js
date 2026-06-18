const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const PAGE_SIZE = 100

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

async function getAdmin(openid) {
  if (!openid) return null
  const user = (await db.collection('users').where({ openid }).limit(1).get()).data[0]
  return user && user.role === 'admin' ? user : null
}

async function fetchAllPendingApplications() {
  let skip = 0
  let hasMore = true
  const items = []
  while (hasMore) {
    const batch = await db.collection('registration_applications')
      .where({ status: 'pending' })
      .field({
        _id: true,
        userId: true,
        nameSnapshot: true,
        projectId: true,
        projectNameSnapshot: true,
        projectAbbrSnapshot: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      })
      .orderBy('createdAt', 'asc')
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

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!(await getAdmin(OPENID))) return fail('PERMISSION_DENIED', '无权限操作')

  const applications = await fetchAllPendingApplications()
  const items = applications.map((item) => ({
    _id: item._id,
    userId: item.userId,
    nameSnapshot: item.nameSnapshot,
    projectId: item.projectId,
    projectName: item.projectNameSnapshot || '',
    projectAbbr: item.projectAbbrSnapshot || '',
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }))

  return ok({ items })
}
