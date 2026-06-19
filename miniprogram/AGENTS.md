# miniprogram/ — Mini-Program Frontend

**Root:** `miniprogram/` (set as `miniprogramRoot` in project.config.json)

## OVERVIEW

Native WeChat Mini-Program source. 26 pages across 7 feature groups, 5 custom components, custom tab bar, CSS token system, 4 utility modules. All cloud calls through `utils/api.js`. Pure JS (CommonJS), no TypeScript.

## STRUCTURE

```
miniprogram/
├── app.js              # App() lifecycle, cloud.init, globalData, auth helpers
├── app.json            # 26 pages, custom tabBar (3 tabs), window config
├── app.wxss            # @import tokens → base → components
├── config.js           # envId, host, demo asset IDs
├── pages/              # 7 feature groups (26 pages)
├── components/         # 5 reusable components
├── custom-tab-bar/     # Custom text-only tab bar component
├── styles/             # Global stylesheets (tokens, base, components, calendar)
└── utils/              # Shared utilities (api, date, status, tabbar)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| App bootstrap | `app.js` | Cloud init, login session, `globalData` (`hasLogin`, `needsLegalAcceptance`, `user`), `isApprovedUser()`, `isAdmin()`, `needsLegalAcceptance()` |
| Page/tab registration | `app.json` | 26 pages, 3 tabs (周历/我的/管理), v2 style |
| Global styles import | `app.wxss` | 3 @import chain: tokens → base → components |
| Service config | `config.js` | Cloud envId, host URL |
| Cloud call wrapper | `utils/api.js` | `callFunction(name, data)` + `showError(err)` |
| Date/time helpers | `utils/date.js` | Week math, 09:00–18:00 working hours, cell ranges |
| Status definitions | `utils/status.js` | 9 booking + 4 registration states, cell CSS mapper |
| Tab bar control | `utils/tabbar.js` | `setTabBarSelected(page, index)` |
| Design tokens | `styles/tokens.wxss` | CSS custom properties: colors, fonts, spacing, radii |
| Base resets | `styles/base.wxss` | `.page` container, button/input resets |
| Shared UI components | `styles/components.wxss` | `.card`, `.list-card`, `.button--*`, `.status-tag--*` |
| Calendar styles | `styles/calendar.wxss` | Grid, toolbar, legend, cell states |

### Pages

| Group | Pages | Key Cloud Functions |
|-------|-------|-------------------|
| `calendar/` | Main week-view (tab 0) | `getPublicCalendar` (graded guest/member/admin visibility), `createBookingV2` |
| `auth/` | Login, register | `login`, `submitRegistrationV2` |
| `booking/` | Form stub (7 lines) | None (redirects to calendar) |
| `profile/` | Hub (tab 1), bookings, project, stats, privacy | `getUserStats`, `listMyBookings` (V1/V2 booking compatibility), `cancelBookingV2`, `getMyProjectOverview` |
| `waitlist/` | My waitlist items | `listMyWaitlists`, `confirmWaitlistV2` (server-side deadline + queue-head recheck) |
| `legal/` | User agreement, privacy policy | `getLegalDocuments`, `acceptLegalDocuments` |
| `admin/` | 13 admin pages (tab 2) | See `pages/admin/AGENTS.md` |

### Components

| Component | Purpose | Used By |
|-----------|---------|---------|
| `calendar-grid` | Week grid with cell touch selection | calendar |
| `time-range-sheet` | Booking confirmation bottom sheet | calendar |
| `status-tag` | Colored status badge (text + tone) | Most pages |
| `empty-state` | Empty/placeholder UI | Most pages |
| `theme-modal` | Reusable modal with optional input | bookings, admin reviews |

### Tab Bar

Custom component at `custom-tab-bar/`. 3 text-only tabs matched to `app.json`. Route-based active detection via `getCurrentPages()`.

## CONVENTIONS

- **Page pattern**: `pages/<feature>/<subpage>/index.{js,json,wxml,wxss}` — all 4 files mandatory
- **Data loading**: Always in `onShow()`, never only in `onLoad()` — pages refresh on every visibility
- **API layer**: ALL cloud function calls via `utils/api.js` — `callFunction(name, data)`
- **Auth gating**: Pages check `getApp().needsLegalAcceptance()` before legal docs; `getApp().isApprovedUser()` (checks `accountStatus === 'active'` AND `registrationStatus === 'approved'`) / `isAdmin()` before operations. Booking and waitlist conversion are re-validated server-side against account status, legal version, `serviceMode`, and waitlist confirmation deadline.
- **Tab bar sync**: Every tab page calls `setTabBarSelected(this, index)` in `onShow()`
- **Imports**: CommonJS `require`/`module.exports` only. No ES modules.
- **WXSS**: Import chain tokens → base → components; page-specific WXSS for layout only
- **Components**: All `"component": true` in `.json`, use `Component({})` with `lifetimes`

## ANTI-PATTERNS

- **Never** call `wx.cloud.callFunction` directly — always use `utils/api.js`
- **Never** hardcode colors in page/component WXSS — use CSS variables from `tokens.wxss`
- **Never** trust client time for validation — cloud functions re-validate server time
- **Never** assume client-side legal or maintenance checks are sufficient — cloud functions are the final authority
- **Never** suppress type errors with `as any` or similar (JS project so N/A but principle holds)
- **Never** use images, icons, gradients, or animations (see `docs/style-guide.md`)
- **Never** duplicate page titles — native nav bar handles titles
