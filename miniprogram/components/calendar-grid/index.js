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
    restrictedSlots: {
      type: Array,
      value: [],
    },
  },

  observers: {
    'days,hours,items,maintenanceSlots,restrictedSlots': function buildCells() {
      this.buildCellMap()
    },
  },

  data: {
    cellMap: {},
    hourTextMap: {},
    longPressTimer: null,
    selecting: false,
    startCell: null,
    currentCell: null,
    gridRect: null,
    selectedMap: {},
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
      this.properties.hours.forEach((hour) => {
        hourTextMap[hour] = `${hour < 10 ? '0' : ''}${hour}:00`
      })

      this.properties.days.forEach((day) => {
        this.properties.hours.forEach((hour) => {
          const key = `${day.date}-${hour}`
          const item = this.findCellItem(day.date, hour)
          if (item) {
            cellMap[key] = item
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
        }
      }

      const restricted = this.properties.restrictedSlots.find((slot) => this.overlaps(keyTime, nextTime, slot.startAt, slot.endAt))
      const booking = this.properties.items.find((item) => this.overlaps(keyTime, nextTime, item.startAt, item.endAt))
      if (booking) {
        return {
          className: getCellClass(booking.status),
          text: booking.displayName || (booking.status === 'pending_review' ? '待审核' : '已占用'),
          subtext: booking.college || '',
          status: booking.status,
          bookingId: booking.bookingId,
        }
      }

      if (restricted) {
        return {
          className: getCellClass('restricted'),
          text: '受限',
          subtext: restricted.reason || '需审核',
          status: 'restricted',
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
        if (cell) selectedMap[`${cell.date}-${cell.hour}`] = true
      }
      this.setData({ selectedMap })
    },

    onTouchStart(event) {
      const startCell = this.makeCell(event)
      const timer = setTimeout(() => {
        this.setData({
          selecting: true,
          startCell,
          currentCell: startCell,
        }, () => this.updateSelectedMap(startCell, startCell))
        wx.vibrateShort({ type: 'light' })
      }, 350)
      this.setData({ longPressTimer: timer, startCell, selectedMap: {} })
    },

    onTouchMove(event) {
      if (!this.data.selecting || !this.data.gridRect) return
      const touch = event.touches && event.touches[0]
      if (!touch) return
      const x = touch.clientX - this.data.gridRect.left - 24 - 88
      const y = touch.clientY - this.data.gridRect.top - 92
      const col = Math.floor(x / 144)
      const row = Math.floor(y / 96)
      if (col < 0 || row < 0 || col >= this.properties.days.length || row >= this.properties.hours.length) return
      const currentCell = {
        date: this.properties.days[col].date,
        hour: this.properties.hours[row],
      }
      this.setData({ currentCell }, () => this.updateSelectedMap(this.data.startCell, currentCell))
    },

    onTouchEnd(event) {
      if (this.data.longPressTimer) {
        clearTimeout(this.data.longPressTimer)
      }
      if (this.data.selecting) {
        const endCell = this.data.currentCell || this.makeCell(event)
        this.triggerEvent('selectrange', {
          startCell: this.data.startCell,
          endCell,
        })
      }
      this.setData({
        selecting: false,
        longPressTimer: null,
        currentCell: null,
        selectedMap: {},
      })
    },

    onCellTap(event) {
      if (this.data.selecting) return
      const cell = this.makeCell(event)
      this.triggerEvent('selectrange', {
        startCell: cell,
        endCell: cell,
      })
    },
  },
})
