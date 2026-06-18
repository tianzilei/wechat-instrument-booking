function setTabBarSelected(page, selected) {
  if (typeof page.getTabBar !== 'function') return
  const tabBar = page.getTabBar()
  if (!tabBar) return
  const themeMap = ['calendar', 'profile', 'admin']
  tabBar.setData({
    selected,
    theme: themeMap[selected] || 'calendar',
  })
}

module.exports = {
  setTabBarSelected,
}
