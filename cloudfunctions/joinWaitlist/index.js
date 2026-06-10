const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) {
  return { success: true, data, error: null }
}

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userRes.data[0]
  if (!user || user.registrationStatus !== 'approved') return fail('REGISTRATION_REQUIRED', '注册审核通过后才能候补')
  const startAt = new Date(event.startAt)
  const endAt = new Date(event.endAt)
  if (!(startAt < endAt)) return fail('INVALID_PARAMS', '时间参数错误')

  const minimumStartAt = new Date()
  minimumStartAt.setMinutes(0, 0, 0)
  minimumStartAt.setHours(minimumStartAt.getHours() + 1)
  if (startAt < minimumStartAt) return fail('INVALID_SEGMENTS', '当前小时及过去时段不可候补')

  if (event.remark) {
    try {
      const checkRes = await cloud.openapi.security.msgSecCheck({ content: event.remark })
      if (checkRes.result && checkRes.result.suggest === 'risky') {
        return fail('CONTENT_UNSAFE', '备注包含违规信息，请修改后重试')
      }
    } catch (err) {
      console.error('msgSecCheck error:', err.errCode || err.message)
    }
  }

  const countRes = await db.collection('waitlists').where({
    startAt,
    endAt,
    status: 'waitlisted',
  }).count()
  const now = db.serverDate()
  const addRes = await db.collection('waitlists').add({
    data: {
      userId: user._id,
      startAt,
      endAt,
      occupiedSegments: [{ startAt, endAt }],
      remark: event.remark || '',
      status: 'waitlisted',
      queueOrder: countRes.total + 1,
      createdAt: now,
      updatedAt: now,
    },
  })

  return ok({ waitlistId: addRes._id, queueOrder: countRes.total + 1, status: 'waitlisted' })
}
