const api = require('../../../utils/api')
const { getRegistrationStatus } = require('../../../utils/status')

Page({
  data: {
    items: [],
  },

  onShow() {
    this.loadItems()
  },

  async loadItems() {
    try {
      const data = await api.callFunction('listUsers')
      const items = (data.items || []).map((item) => {
        const status = getRegistrationStatus(item.registrationStatus)
        return {
          ...item,
          statusText: status.text,
          statusTone: status.tone,
        }
      })
      this.setData({ items })
    } catch (err) {
      this.setData({ items: [] })
    }
  },
})
