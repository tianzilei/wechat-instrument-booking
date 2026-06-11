const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('AUTH_REQUIRED', '未授权')

  const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  if (!userRes.data[0]) return fail('AUTH_REQUIRED', '请先登录')

  const fileList = event.fileIdList
  if (!Array.isArray(fileList) || fileList.length === 0) return fail('INVALID_PARAMS', '参数错误')
  if (fileList.length > 20) return fail('INVALID_PARAMS', '单次最多 20 个文件')

  const result = await cloud.getTempFileURL({ fileList })
  return result.fileList
}
