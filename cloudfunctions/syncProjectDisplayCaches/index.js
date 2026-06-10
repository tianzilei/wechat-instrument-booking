const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event) => {
  if (!event.projectId) return { success: true, data: { synced: 0 } }

  const project = (await db.collection('projects').doc(event.projectId).field({ abbr: true, displayVersion: true }).get()).data
  if (!project) return { success: true, data: { synced: 0 } }

  const cursor = event.cursor || 0
  const batch = await db.collection('bookings').where({
    projectId: event.projectId,
    projectDisplayVersion: db.command.lt(project.displayVersion),
  }).skip(cursor).limit(50).get()

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
      nextCursor: batch.data.length >= 50 ? cursor + 50 : null,
    },
  }
}
