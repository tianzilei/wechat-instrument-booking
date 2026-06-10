const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

exports.main = async (event) => {
  if (!event.proposedName && !event.proposedAbbr) return fail('INVALID_PARAMS', '请提供课题名称或缩写')

  const name = (event.proposedName || '').trim()
  const abbr = (event.proposedAbbr || '').trim()
  const results = []

  if (name) {
    const normalizedName = name.replace(/\s+/g, '').toLowerCase()
    const regex = db.RegExp({ regexp: normalizedName.slice(0, 4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
    const nameMatches = await db.collection('projects').where({
      status: 'active',
      normalizedName: regex,
    }).field({ _id: true, name: true, abbr: true }).limit(5).get()
    results.push(...nameMatches.data)
  }

  if (abbr && results.length < 5) {
    const normalizedAbbr = abbr.replace(/\s+/g, '').toLowerCase()
    const regex = db.RegExp({ regexp: normalizedAbbr.slice(0, 3).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
    const abbrMatches = await db.collection('projects').where({
      status: 'active',
      normalizedAbbr: regex,
      _id: db.command.nin(results.map((r) => r._id)),
    }).field({ _id: true, name: true, abbr: true }).limit(5 - results.length).get()
    results.push(...abbrMatches.data)
  }

  return ok({ matches: results.slice(0, 5) })
}
