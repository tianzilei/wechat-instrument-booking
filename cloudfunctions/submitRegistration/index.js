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
  const fields = ['name', 'phone', 'studentId', 'college', 'supervisor']
  const missing = fields.find((field) => !event[field])
  if (missing) return fail('INVALID_PARAMS', '请完整填写申请信息')
  if (!/^1\d{10}$/.test(event.phone)) return fail('INVALID_PARAMS', '手机号格式不正确')

  const users = db.collection('users')
  const now = db.serverDate()
  const existing = await users.where({ openid: OPENID }).limit(1).get()
  if (existing.data.length === 0) {
    const res = await users.add({
      data: {
        openid: OPENID,
        role: 'user',
        registrationStatus: 'pending',
        name: event.name,
        phone: event.phone,
        studentId: event.studentId,
        college: event.college,
        supervisor: event.supervisor,
        rejectReason: '',
        createdAt: now,
        updatedAt: now,
      },
    })
    return ok({ userId: res._id, registrationStatus: 'pending' })
  }

  const user = existing.data[0]
  if (user.registrationStatus === 'approved') return fail('STATE_CHANGED', '注册已通过，无需重复提交')

  await users.doc(user._id).update({
    data: {
      registrationStatus: 'pending',
      name: event.name,
      phone: event.phone,
      studentId: event.studentId,
      college: event.college,
      supervisor: event.supervisor,
      rejectReason: '',
      updatedAt: now,
    },
  })

  return ok({ userId: user._id, registrationStatus: 'pending' })
}
