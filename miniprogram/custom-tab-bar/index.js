Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/calendar/index',
        text: '周历',
        theme: 'calendar',
        activeColor: '#0f766e',
      },
      {
        pagePath: '/pages/profile/index/index',
        text: '我的',
        theme: 'profile',
        activeColor: '#1d5f8a',
      },
      {
        pagePath: '/pages/admin/index/index',
        text: '管理',
        theme: 'admin',
        activeColor: '#8e4038',
      },
    ],
    theme: 'calendar',
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
        this.setData({
          selected,
          theme: this.data.list[selected].theme || 'calendar',
        })
      }
    },

    switchTab(event) {
      const { index, path } = event.currentTarget.dataset
      const nextIndex = Number(index)
      this.setData({
        selected: nextIndex,
        theme: (this.data.list[nextIndex] && this.data.list[nextIndex].theme) || 'calendar',
      })
      wx.switchTab({ url: path })
    },
  },
})
