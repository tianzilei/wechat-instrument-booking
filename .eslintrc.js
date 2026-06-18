module.exports = {
  root: true,
  extends: ['airbnb-base'],
  env: {
    es6: true,
  },
  parserOptions: {
    ecmaVersion: 2018,
  },
  globals: {
    App: 'readonly',
    Behavior: 'readonly',
    Component: 'readonly',
    Page: 'readonly',
    getApp: 'readonly',
    getCurrentPages: 'readonly',
    wx: 'readonly',
  },
  overrides: [
    {
      files: ['cloudfunctions/**/*.js'],
      env: {
        node: true,
      },
    },
    {
      files: ['miniprogram/**/*.js'],
      env: {
        browser: true,
        node: true,
      },
    },
  ],
}
