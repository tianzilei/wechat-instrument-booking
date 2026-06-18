const { getCellClass } = require('../../utils/status')

Component({
  properties: {
    days: {
      type: Array,
      value: [],
    },
    hours: {
      type: Array,
      value: [],
    },
    items: {
      type: Array,
      value: [],
    },
    maintenanceSlots: {
      type: Array,
      value: [],
    },
    isAdmin: {
      type: Boolean,
      value: false,
    },
  },

  observers: {
    'days,hours,items,maintenanceSlots,isAdmin': function buildCells() {
      this.buildCellMap()
    },
  },

  data: {
    cellMap: {},
    hourTextMap: {},
    longPressTimer: null,
    selecting: false,
    startCell: null,
    gridRect: null,
    selectedMap: {},
    selectedCount: 0,
    suppressNextTap: false,
    suppressTapKey: '',
    touchStartPoint: null,
  },

  lifetimes: {
    attached() {
      this.buildCellMap()
    },
    ready() {
      this.measureGrid()
    },
  },

  methods: {
    buildCellMap() {
      const cellMap = {}
      const hourTextMap = {}
      const now = new Date()
      const minimumStartAt = new Date(now)
      minimumStartAt.setMinutes(0, 0, 0)
      minimumStartAt.setHours(minimumStartAt.getHours() + 1)

      this.properties.hours.forEach((hour) => {
        hourTextMap[hour] = `${hour < 10 ? '0' : ''}${hour}:00`
      })

      this.properties.days.forEach((day) => {
        this.properties.hours.forEach((hour) => {
          const key = `${day.date}-${hour}`
          const cellTime = new Date(`${day.date}T00:00:00`)
          cellTime.setHours(hour, 0, 0, 0)
          const isPast = cellTime < minimumStartAt

          const item = this.findCellItem(day.date, hour)
          if (item) {
            if (isPast) {
              cellMap[key] = {
                className: 'calendar-cell--past',
                text: '已结束',
                subtext: '',
                status: 'past',
              }
            } else {
              cellMap[key] = item
            }
          } else if (isPast) {
            cellMap[key] = {
              className: 'calendar-cell--past',
              text: '',
              subtext: '',
              status: 'past',
            }
          } else {
            cellMap[key] = {
              className: getCellClass('available'),
              text: '',
              subtext: '',
              status: 'available',
            }
          }
        })
      })

      this.setData({ cellMap, hourTextMap }, () => this.measureGrid())
    },

    measureGrid() {
      wx.createSelectorQuery()
        .in(this)
        .select('.calendar-grid')
        .boundingClientRect((rect) => {
          if (rect) this.setData({ gridRect: rect })
        })
        .exec()
    },

    findCellItem(date, hour) {
      const keyTime = new Date(`${date}T00:00:00`).setHours(hour, 0, 0, 0)
      const nextTime = keyTime + 60 * 60 * 1000
      const maintenance = this.properties.maintenanceSlots.find((slot) => this.overlaps(keyTime, nextTime, slot.startAt, slot.endAt))
      if (maintenance) {
        return {
          className: getCellClass('maintenance'),
          text: '维护',
          subtext: maintenance.reason || '',
          status: 'maintenance',
          maintenanceId: maintenance.maintenanceId || maintenance._id || '',
        }
      }

      const booking = this.properties.items.find((item) => this.overlaps(keyTime, nextTime, item.startAt, item.endAt))
      if (booking) {
        return {
          className: getCellClass(booking.status),
          text: booking.projectAbbr || (booking.status === 'pending_review' ? '待审核' : '已占用'),
          subtext: booking.userName || '',
          status: booking.status,
          bookingId: booking.bookingId,
        }
      }

      return null
    },

    overlaps(cellStart, cellEnd, startAt, endAt) {
      const start = new Date(startAt).getTime()
      const end = new Date(endAt).getTime()
      return cellStart < end && cellEnd > start
    },

    makeCell(event) {
      const { date, hour } = event.currentTarget.dataset
      return {
        date,
        hour: Number(hour),
      }
    },

    getCellData(cell) {
      const key = `${cell.date}-${cell.hour}`
      return this.data.cellMap[key] || null
    },

    isSelectableCell(cell) {
      const cellData = this.getCellData(cell)
      if (!cellData) return false
      if (cellData.status === 'past' || cellData.status === 'maintenance') return false
      if (this.properties.isAdmin) {
        return ['available', 'confirmed', 'pending_review'].includes(cellData.status)
      }
      return cellData.status === 'available'
    },

    getCellIndex(cell) {
      const dayIndex = this.properties.days.findIndex((day) => day.date === cell.date)
      const hourIndex = this.properties.hours.findIndex((hour) => hour === cell.hour)
      if (dayIndex < 0 || hourIndex < 0) return -1
      return dayIndex * this.properties.hours.length + hourIndex
    },

    getCellByIndex(index) {
      const dayIndex = Math.floor(index / this.properties.hours.length)
      const hourIndex = index % this.properties.hours.length
      const day = this.properties.days[dayIndex]
      const hour = this.properties.hours[hourIndex]
      if (!day || hour === undefined) return null
      return {
        date: day.date,
        hour,
      }
    },

    getSelectedCells() {
      return Object.keys(this.data.selectedMap)
        .map((key) => {
          const dividerIndex = key.lastIndexOf('-')
          return {
            date: key.slice(0, dividerIndex),
            hour: Number(key.slice(dividerIndex + 1)),
          }
        })
        .sort((a, b) => this.getCellIndex(a) - this.getCellIndex(b))
    },

    updateSelectedMap(startCell, endCell) {
      if (!startCell || !endCell) return
      const startIndex = this.getCellIndex(startCell)
      const endIndex = this.getCellIndex(endCell)
      if (startIndex < 0 || endIndex < 0) return
      const from = Math.min(startIndex, endIndex)
      const to = Math.max(startIndex, endIndex)
      const selectedMap = {}
      for (let index = from; index <= to; index += 1) {
        const cell = this.getCellByIndex(index)
        if (cell && this.isSelectableCell(cell)) selectedMap[`${cell.date}-${cell.hour}`] = true
      }
      this.setData({
        selectedMap,
        selectedCount: Object.keys(selectedMap).length,
      })
    },

    toggleSelectedCell(cell) {
      if (!this.isSelectableCell(cell)) return
      const key = `${cell.date}-${cell.hour}`
      const selectedMap = { ...this.data.selectedMap }
      if (selectedMap[key]) {
        delete selectedMap[key]
      } else {
        selectedMap[key] = true
      }
      this.setData({
        selectedMap,
        selectedCount: Object.keys(selectedMap).length,
      })
    },

    onTouchStart(event) {
      if (this.data.selecting) return
      const startCell = this.makeCell(event)
      if (!this.isSelectableCell(startCell)) return
      const touch = (event.touches && event.touches[0]) || null
      const startKey = `${startCell.date}-${startCell.hour}`
      const timer = setTimeout(() => {
        this.setData({
          selecting: true,
          startCell,
          suppressNextTap: true,
          suppressTapKey: startKey,
        }, () => {
          this.updateSelectedMap(startCell, startCell)
          this.triggerEvent('selectmodechange', { selecting: true })
        })
        wx.vibrateShort({ type: 'light' })
      }, 350)
      this.setData({
        longPressTimer: timer,
        startCell,
        selectedMap: {},
        selectedCount: 0,
        touchStartPoint: touch ? { x: touch.clientX, y: touch.clientY } : null,
      })
    },

    onTouchMove(event) {
      if (!this.data.longPressTimer || !this.data.touchStartPoint) return
      const touch = (event.touches && event.touches[0]) || null
      if (!touch) return
      const deltaX = Math.abs(touch.clientX - this.data.touchStartPoint.x)
      const deltaY = Math.abs(touch.clientY - this.data.touchStartPoint.y)
      if (deltaX >= 8 || deltaY >= 8) {
        clearTimeout(this.data.longPressTimer)
        this.setData({
          longPressTimer: null,
          touchStartPoint: null,
        })
      }
    },

    onTouchEnd() {
      if (this.data.longPressTimer) {
        clearTimeout(this.data.longPressTimer)
      }
      this.setData({
        longPressTimer: null,
        touchStartPoint: null,
      })
    },

    onCellTap(event) {
      const cell = this.makeCell(event)
      const cellData = this.getCellData(cell)
      const key = `${cell.date}-${cell.hour}`

      if (!cellData || cellData.status === 'past') return
      if (this.data.suppressNextTap && this.data.suppressTapKey === key) {
        this.setData({
          suppressNextTap: false,
          suppressTapKey: '',
        })
        return
      }
      if (this.data.suppressNextTap) {
        this.setData({
          suppressNextTap: false,
          suppressTapKey: '',
        })
      }
      if (this.data.selecting) {
        this.toggleSelectedCell(cell)
        return
      }
      this.triggerEvent('celltap', {
        cell,
        cellData,
      })
    },

    cancelMultiSelect() {
      const wasSelecting = this.data.selecting
      this.setData({
        selecting: false,
        startCell: null,
        selectedMap: {},
        selectedCount: 0,
        suppressNextTap: false,
        suppressTapKey: '',
      })
      if (wasSelecting) {
        this.triggerEvent('selectmodechange', { selecting: false })
      }
    },

    confirmMultiSelect() {
      const selectedCells = this.getSelectedCells()
      if (selectedCells.length === 0) {
        wx.showToast({
          title: '请先选择时间',
          icon: 'none',
        })
        return
      }
      this.triggerEvent('selectrange', {
        startCell: selectedCells[0],
        endCell: selectedCells[selectedCells.length - 1],
        selectedCells,
        selectedEntries: selectedCells.map((cell) => ({
          ...cell,
          status: this.getCellData(cell).status,
        })),
      })
      this.cancelMultiSelect()
    },
  },
})
