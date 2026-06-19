function callFunctionRaw(name, data = {}) {
  return wx.cloud.callFunction({
    name,
    data,
  }).then((res) => res.result || {})
}

function callFunction(name, data = {}) {
  return callFunctionRaw(name, data).then((result) => {
    if (!result.success) {
      const message = result.error && result.error.message ? result.error.message : '操作失败'
      const err = new Error(message)
      err.code = result.error && result.error.code ? result.error.code : 'CALL_FUNCTION_FAILED'
      err.result = result
      throw err
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
  callFunctionRaw,
  showError,
}
