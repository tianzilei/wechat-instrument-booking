Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/calendar/index',
        text: '周历',
      },
      {
        pagePath: '/pages/profile/index/index',
        text: '我的',
      },
      {
        pagePath: '/pages/admin/index/index',
        text: '管理',
      },
    ],
  },

  lifetimes: {
    attached() {
      this.updateSelected()
    },
  },

  pageLifetimes: {
    show() {
      this.updateSelected()
    },
  },

  methods: {
    updateSelected() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      if (!current) return
      const route = `/${current.route}`
      const selected = this.data.list.findIndex((item) => item.pagePath === route)
      if (selected >= 0) {
        this.setData({ selected })
      }
    },

    switchTab(event) {
      const { index, path } = event.currentTarget.dataset
      this.setData({
        selected: Number(index),
      })
      wx.switchTab({ url: path })
    },
  },
})
