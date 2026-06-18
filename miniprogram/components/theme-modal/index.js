Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '',
    },
    content: {
      type: String,
      value: '',
    },
    showInput: {
      type: Boolean,
      value: false,
    },
    placeholder: {
      type: String,
      value: '',
    },
    maxlength: {
      type: Number,
      value: 200,
    },
    confirmText: {
      type: String,
      value: '确认',
    },
    cancelText: {
      type: String,
      value: '取消',
    },
    confirmTone: {
      type: String,
      value: 'primary',
    },
    payload: {
      type: Object,
      value: {},
    },
    closeOnMask: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    value: '',
  },

  observers: {
    visible(value) {
      if (value) this.setData({ value: '' })
    },
  },

  methods: {
    noop() {},
    onInput(event) {
      this.setData({ value: event.detail.value })
    },
    onCancel() {
      this.triggerEvent('cancel')
    },
    onMaskTap() {
      if (this.properties.closeOnMask) {
        this.onCancel()
      }
    },
    onConfirm() {
      this.triggerEvent('confirm', {
        value: this.data.value,
        payload: this.properties.payload,
      })
    },
  },
})
