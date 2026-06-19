const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

async function ensureInternalOrAdmin() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return true
  const user = (await db.collection('users').where({ openid: OPENID }).field({ role: true }).limit(1).get()).data[0]
  return !!(user && user.role === 'admin')
}

exports.main = async (event) => {
  if (!(await ensureInternalOrAdmin())) {
    return { success: false, data: null, error: { code: 'PERMISSION_DENIED', message: '无权限操作' } }
  }
  if (!event.projectId || typeof event.projectId !== 'string') return { success: true, data: { synced: 0 } }

  const project = (await db.collection('projects').doc(event.projectId).field({ abbr: true, displayVersion: true }).get()).data
  if (!project) return { success: true, data: { synced: 0 } }

  const batch = await db.collection('bookings').where({
    projectId: event.projectId,
    projectDisplayVersion: db.command.lt(project.displayVersion),
  }).limit(50).get()

  const now = db.serverDate()
  for (const b of batch.data) {
    await db.collection('bookings').doc(b._id).update({
      data: {
        projectAbbrDisplayCache: project.abbr,
        projectDisplayVersion: project.displayVersion,
        updatedAt: now,
      },
    })
  }

  return {
    success: true,
    data: {
      synced: batch.data.length,
      hasMore: batch.data.length >= 50,
      nextCursor: null,
    },
  }
}
