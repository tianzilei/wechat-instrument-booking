const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async (event) => {
  const keyword = (event.keyword || '').trim()
  if (keyword.length < 2) return fail('INVALID_PARAMS', '请输入至少2个字符')

  const regex = db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
  const res = await db.collection('projects')
    .where({
      status: 'active',
      name: regex,
    })
    .field({ _id: true, name: true, abbr: true })
    .limit(5)
    .get()

  const abbrRes = await db.collection('projects')
    .where({
      status: 'active',
      abbr: regex,
      _id: db.command.nin(res.data.map((p) => p._id)),
    })
    .field({ _id: true, name: true, abbr: true })
    .limit(5 - res.data.length)
    .get()

  return ok({ items: [...res.data, ...abbrRes.data].slice(0, 5) })
}
