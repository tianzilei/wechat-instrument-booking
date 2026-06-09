function callFunction(name, data = {}) {
  return wx.cloud.callFunction({
    name,
    data,
  }).then((res) => {
    const result = res.result || {}
    if (!result.success) {
      const message = result.error && result.error.message ? result.error.message : '操作失败'
      throw new Error(message)
    }
    return result.data
  })
}

function showError(err) {
  wx.showToast({
    title: err && err.message ? err.message : '操作失败',
    icon: 'none',
  })
}

module.exports = {
  callFunction,
  showError,
}
