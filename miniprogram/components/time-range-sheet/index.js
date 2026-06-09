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
    disabled: {
      type: Boolean,
      value: false,
    },
    primaryClass: {
      type: String,
      value: 'button--primary',
    },
  },

  data: {
    remark: '',
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
      this.triggerEvent('submit', {
        remark: this.data.remark,
      })
    },
  },
})
