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

  if (!event.projectId || !['active', 'inactive'].includes(event.action)) return fail('INVALID_PARAMS', '参数错误')

  const projectRef = db.collection('projects').doc(event.projectId)
  const project = (await projectRef.get()).data
  if (!project) return fail('NOT_FOUND', '课题不存在')

  const now = db.serverDate()
  const results = { cancelledBookings: 0, affectedUsers: 0 }

  if (event.action === 'inactive') {
    if (event.reason) {
      try {
        const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.reason })
        if (checkRes.result && checkRes.result.suggest === 'risky') {
          return fail('CONTENT_UNSAFE', '停用原因包含违规信息')
        }
      } catch (err) {
        console.error('msgSecCheck error:', err.errCode || err.message)
      return fail('CONTENT_UNSAFE', '内容安全检查失败，请稍后重试')
      }
    }

    const members = await db.collection('users').where({
      projectId: event.projectId,
      accountStatus: 'active',
    }).limit(500).get()
    await Promise.all(members.data.map((m) => db.collection('users').doc(m._id).update({
      data: { accountStatus: 'project_reassignment_required', updatedAt: now },
    })))
    results.affectedUsers = members.data.length

    const bookings = await db.collection('bookings').where({
      projectId: event.projectId,
      status: _.in(['pending_review', 'confirmed', 'cancel_pending']),
    }).limit(500).get()
    await Promise.all(bookings.data.map((b) => db.collection('bookings').doc(b._id).update({
      data: { status: 'cancelled', cancellationNote: 'project_inactive', updatedAt: now },
    })))
    results.cancelledBookings = bookings.data.length

    await projectRef.update({
      data: { status: 'inactive', inactiveReason: event.reason || '', updatedAt: now },
    })

    await db.collection('review_logs').add({
      data: { targetType: 'project', targetId: event.projectId, action: 'inactive', reason: event.reason || '', reviewerId: admin._id, createdAt: now },
    })
  } else {
    await projectRef.update({ data: { status: 'active', inactiveReason: '', updatedAt: now } })
    await db.collection('review_logs').add({
      data: { targetType: 'project', targetId: event.projectId, action: 'active', reason: '管理员重新启用', reviewerId: admin._id, createdAt: now },
    })
  }

  return ok({ projectId: event.projectId, status: event.action, ...results })
}
