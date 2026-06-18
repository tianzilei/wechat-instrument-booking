Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '预约仪器',
    },
    timeText: {
      type: String,
      value: '',
    },
    hint: {
      type: String,
      value: '',
    },
    hintTone: {
      type: String,
      value: 'warning',
    },
    submitText: {
      type: String,
      value: '确认预约',
    },
    cancelText: {
      type: String,
      value: '取消',
    },
    disabled: {
      type: Boolean,
      value: false,
    },
    primaryClass: {
      type: String,
      value: 'button--primary',
    },
    showSubmit: {
      type: Boolean,
      value: true,
    },
    showRemark: {
      type: Boolean,
      value: true,
    },
    detailLines: {
      type: Array,
      value: [],
    },
  },

  data: {
    remark: '',
  },

  observers: {
    visible(value) {
      if (!value) {
        this.setData({ remark: '' })
      }
    },
  },

  methods: {
    noop() {},
    onRemarkInput(event) {
      this.setData({
        remark: event.detail.value,
      })
    },
    onClose() {
      this.setData({ remark: '' })
      this.triggerEvent('close')
    },
    onSubmit() {
      if (!this.properties.showSubmit || this.properties.disabled) return
      this.triggerEvent('submit', {
        remark: this.data.remark,
      })
    },
  },
})
