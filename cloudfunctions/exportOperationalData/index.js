const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const PAGE_SIZE = 100
const EXPORT_LIMIT = 5000
const IN_QUERY_SIZE = 100

function ok(data) { return { success: true, data, error: null } }
function fail(code, message) { return { success: false, data: null, error: { code, message } } }

async function getAdmin(openid) {
  if (!openid) return null
  const res = await db.collection('users').where({ openid }).limit(1).get()
  const user = res.data[0]
  return user && user.role === 'admin' ? user : null
}

async function fetchCollection(name, fields) {
  const items = []
  let offset = 0
  let hasMore = true

  while (hasMore && offset < EXPORT_LIMIT) {
    const res = await db.collection(name)
      .field(fields)
      .skip(offset)
      .limit(PAGE_SIZE)
      .get()
    items.push(...res.data)
    offset += res.data.length
    hasMore = res.data.length === PAGE_SIZE
  }

  return {
    items,
    truncated: hasMore && offset >= EXPORT_LIMIT,
  }
}

async function getSettings() {
  try {
    const res = await db.collection('settings').doc('global').get()
    const settings = res.data || {}
    return {
      timezone: settings.timezone,
      openStartHour: settings.openStartHour,
      openEndHour: settings.openEndHour,
      maxAdvanceDays: settings.maxAdvanceDays,
      rulesVersion: settings.rulesVersion,
      processedRulesVersion: settings.processedRulesVersion,
      serviceMode: settings.serviceMode,
      serviceAgreementVersion: settings.serviceAgreementVersion,
      privacyPolicyVersion: settings.privacyPolicyVersion,
      updatedAt: settings.updatedAt,
    }
  } catch (err) {
    return {}
  }
}

function buildMap(items, keyField) {
  return (items || []).reduce((map, item) => {
    if (!item || !item[keyField]) return map
    return {
      ...map,
      [item[keyField]]: item,
    }
  }, {})
}

function chunk(items, size) {
  const batches = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

async function fetchUsersByIds(userIds) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))]
  const items = []
  for (const ids of chunk(uniqueIds, IN_QUERY_SIZE)) {
    const res = await db.collection('users').where({
      _id: db.command.in(ids),
    }).field({
      _id: true,
      name: true,
      projectName: true,
      projectAbbr: true,
    }).get()
    items.push(...res.data)
  }
  return items
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  const admin = await getAdmin(OPENID)
  if (!admin) return fail('PERMISSION_DENIED', '无权限操作')

  const [
    settings,
    projects,
    bookings,
    waitlists,
    maintenanceSlots,
    restrictedSlots,
    monthlyStats,
    userCount,
    registrationCount,
    projectApplicationCount,
  ] = await Promise.all([
    getSettings(),
    fetchCollection('projects', {
      _id: true, name: true, abbr: true, status: true, createdAt: true, updatedAt: true,
    }),
    fetchCollection('bookings', {
      _id: true,
      userId: true,
      projectId: true,
      projectAbbrDisplayCache: true,
      segments: true,
      firstStartAt: true,
      lastEndAt: true,
      durationHours: true,
      status: true,
      bookingType: true,
      createdAt: true,
      updatedAt: true,
    }),
    fetchCollection('waitlists', {
      _id: true,
      userId: true,
      projectId: true,
      projectAbbrDisplayCache: true,
      scheduleKey: true,
      segments: true,
      status: true,
      confirmDeadlineAt: true,
      convertedBookingId: true,
      createdAt: true,
      updatedAt: true,
    }),
    fetchCollection('maintenance_slots', {
      _id: true, startAt: true, endAt: true, reason: true, status: true, createdAt: true,
    }),
    fetchCollection('restricted_slots', {
      _id: true, startAt: true, endAt: true, reason: true, status: true, createdAt: true,
    }),
    fetchCollection('monthly_stats', {
      _id: true,
      month: true,
      date: true,
      totalHours: true,
      workingHours: true,
      nonWorkingHours: true,
      cancelCount: true,
      maintenanceHours: true,
      createdAt: true,
    }),
    db.collection('users').count(),
    db.collection('registration_applications').count(),
    db.collection('project_applications').count(),
  ])

  const exportUsers = await fetchUsersByIds([
    ...bookings.items.map((item) => item.userId),
    ...waitlists.items.map((item) => item.userId),
  ])
  const userMap = buildMap(exportUsers, '_id')
  const projectMap = buildMap(projects.items, '_id')
  const exportedBookings = bookings.items.map((item) => {
    const user = userMap[item.userId] || {}
    const project = projectMap[item.projectId] || {}
    return {
      ...item,
      userName: user.name || '',
      projectName: project.name || user.projectName || '',
      projectAbbr: item.projectAbbrDisplayCache || project.abbr || user.projectAbbr || '',
    }
  })
  const exportedWaitlists = waitlists.items.map((item) => {
    const user = userMap[item.userId] || {}
    const project = projectMap[item.projectId] || {}
    return {
      ...item,
      userName: user.name || '',
      projectName: project.name || user.projectName || '',
      projectAbbr: item.projectAbbrDisplayCache || project.abbr || user.projectAbbr || '',
    }
  })

  const now = new Date()
  const exportData = {
    schemaVersion: 2,
    generatedAt: now.toISOString(),
    exportScope: 'Admin-only operational export for internal scheduling, project governance, and booking audits.',
    privacyNotice: 'This admin-only export includes booking user names and project affiliation. It excludes openid, booking remarks, privacy requests, and review logs.',
    summary: {
      users: userCount.total,
      registrationApplications: registrationCount.total,
      projectApplications: projectApplicationCount.total,
    },
    settings,
    projects: projects.items,
    bookings: exportedBookings,
    waitlists: exportedWaitlists,
    maintenanceSlots: maintenanceSlots.items,
    restrictedSlots: restrictedSlots.items,
    monthlyStats: monthlyStats.items,
    truncated: {
      projects: projects.truncated,
      bookings: bookings.truncated,
      waitlists: waitlists.truncated,
      maintenanceSlots: maintenanceSlots.truncated,
      restrictedSlots: restrictedSlots.truncated,
      monthlyStats: monthlyStats.truncated,
    },
  }
  const fileName = `operational-data-${now.toISOString().slice(0, 10)}.json`
  const cloudPath = `admin-exports/${admin._id}/operational-data.json`
  const upload = await cloud.uploadFile({
    cloudPath,
    fileContent: Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'),
  })
  const temp = await cloud.getTempFileURL({ fileList: [upload.fileID] })
  const file = temp.fileList[0]
  if (!file || !file.tempFileURL) return fail('EXPORT_FAILED', '导出文件生成失败')

  await db.collection('review_logs').add({
    data: {
      targetType: 'system',
      targetId: 'operational-data',
      action: 'export',
      reason: '',
      reviewerId: admin._id,
      createdAt: db.serverDate(),
    },
  })

  return ok({
    fileId: upload.fileID,
    tempFileURL: file.tempFileURL,
    fileName,
    truncated: exportData.truncated,
  })
}
