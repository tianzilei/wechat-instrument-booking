const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function fail(code, message) {
  return { success: false, data: null, error: { code, message } }
}

exports.main = async () => fail('DEPRECATED', '受限时段已下线，请改用维护时间')
