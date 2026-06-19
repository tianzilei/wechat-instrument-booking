function normalizeCallError(err) {
  if (err && err.code && err.message) return err
  const error = err instanceof Error ? err : new Error('连接服务失败，请检查网络后重试')
  error.code = error.code || 'NETWORK_ERROR'
  if (!error.message || error.message.indexOf('callFunction:fail') >= 0) {
    error.message = '连接服务失败，请检查网络后重试'
  }
  return error
}

function callFunctionRaw(name, data = {}) {
  return wx.cloud.callFunction({
    name,
    data,
  }).then((res) => res.result || {}).catch((err) => {
    throw normalizeCallError(err)
  })
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
