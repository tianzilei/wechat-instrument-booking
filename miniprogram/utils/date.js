const MS_PER_DAY = 24 * 60 * 60 * 1000
const OPEN_START_HOUR = 9
const OPEN_END_HOUR = 18

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function formatDate(date) {
  const target = new Date(date)
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`
}

function formatTime(date) {
  const target = new Date(date)
  return `${pad(target.getHours())}:${pad(target.getMinutes())}`
}

function formatDateTime(date) {
  return `${formatDate(date)} ${formatTime(date)}`
}

function startOfDay(date) {
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return target
}

function getWeekStart(date = new Date()) {
  const target = startOfDay(date)
  const day = target.getDay()
  const diff = day === 0 ? -6 : 1 - day
  target.setDate(target.getDate() + diff)
  return target
}

function addDays(date, days) {
  const target = new Date(date)
  target.setDate(target.getDate() + days)
  return target
}

function getWeekDays(weekStart) {
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  return labels.map((label, index) => {
    const date = addDays(weekStart, index)
    return {
      label,
      date: formatDate(date),
      displayDate: formatDate(date).slice(5),
      day: date.getDate(),
      isWeekend: index >= 5,
    }
  })
}

function getHours(includeNight) {
  if (includeNight) {
    return Array.from({ length: 24 }, (_, index) => index)
  }
  return Array.from({ length: OPEN_END_HOUR - OPEN_START_HOUR }, (_, index) => OPEN_START_HOUR + index)
}

function isWholeHour(date) {
  const target = new Date(date)
  return target.getMinutes() === 0 && target.getSeconds() === 0 && target.getMilliseconds() === 0
}

function isWeekend(date) {
  const day = new Date(date).getDay()
  return day === 0 || day === 6
}

function isWorkingHour(date) {
  const target = new Date(date)
  const hour = target.getHours()
  return !isWeekend(target) && hour >= OPEN_START_HOUR && hour < OPEN_END_HOUR
}

function toCellDate(dateString, hour) {
  const date = new Date(`${dateString}T00:00:00`)
  date.setHours(hour, 0, 0, 0)
  return date
}

function buildRangeFromCells(startCell, endCell) {
  if (!startCell || !endCell) return null
  const start = toCellDate(startCell.date, startCell.hour)
  const end = toCellDate(endCell.date, endCell.hour + 1)
  const startTime = start.getTime()
  const endTime = end.getTime()
  return {
    startAt: new Date(Math.min(startTime, endTime - 60 * 60 * 1000)),
    endAt: new Date(Math.max(startTime + 60 * 60 * 1000, endTime)),
  }
}

function splitWorkingSegments(startAt, endAt) {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const segments = []
  let cursor = startOfDay(start)

  while (cursor.getTime() <= end.getTime()) {
    const dayOpen = new Date(cursor)
    dayOpen.setHours(OPEN_START_HOUR, 0, 0, 0)
    const dayClose = new Date(cursor)
    dayClose.setHours(OPEN_END_HOUR, 0, 0, 0)
    const segmentStart = new Date(Math.max(start.getTime(), dayOpen.getTime()))
    const segmentEnd = new Date(Math.min(end.getTime(), dayClose.getTime()))
    if (segmentStart < segmentEnd) {
      segments.push({
        startAt: segmentStart,
        endAt: segmentEnd,
        isWorkingHours: !isWeekend(segmentStart),
      })
    }
    cursor = new Date(cursor.getTime() + MS_PER_DAY)
  }

  return segments
}

function getDurationHours(segments) {
  return segments.reduce((total, segment) => total + ((new Date(segment.endAt) - new Date(segment.startAt)) / 3600000), 0)
}

module.exports = {
  OPEN_START_HOUR,
  OPEN_END_HOUR,
  formatDate,
  formatTime,
  formatDateTime,
  getWeekStart,
  addDays,
  getWeekDays,
  getHours,
  isWholeHour,
  isWeekend,
  isWorkingHour,
  toCellDate,
  buildRangeFromCells,
  splitWorkingSegments,
  getDurationHours,
}
