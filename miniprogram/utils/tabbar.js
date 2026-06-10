function setTabBarSelected(page, selected) {
  if (typeof page.getTabBar !== 'function') return
  const tabBar = page.getTabBar()
  if (!tabBar) return
  tabBar.setData({ selected })
}

module.exports = {
  setTabBarSelected,
}
