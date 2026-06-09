const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const users = db.collection('users')
  const now = db.serverDate()
  const existing = await users.where({ openid: OPENID }).limit(1).get()

  if (existing.data.length === 0) {
    const addRes = await users.add({
      data: {
        openid: OPENID,
        role: 'user',
        registrationStatus: 'unsubmitted',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      },
    })
    return ok({
      openid: OPENID,
      user: {
        _id: addRes._id,
        openid: OPENID,
        role: 'user',
        registrationStatus: 'unsubmitted',
      },
    })
  }

  const user = existing.data[0]
  await users.doc(user._id).update({
    data: {
      lastLoginAt: now,
      updatedAt: now,
    },
  })

  return ok({
    openid: OPENID,
    user,
  })
}
