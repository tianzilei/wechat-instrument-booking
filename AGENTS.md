# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-18T09:03:07Z
**Commit:** e85d5c5
**Branch:** main

## OVERVIEW

仪器预约小程序 — WeChat Mini-Program instrument booking system with CloudBase backend. Public calendar view, registration with admin approval, hourly booking with review workflows, waitlist, maintenance/restricted time slots, usage statistics, project management, privacy/legal compliance, data lifecycle, and account lifecycle.

**Stack:** WeChat Mini-Program (native WXML/WXSS/JS) + WeChat CloudBase (Node.js 18.15 cloud functions)

## STRUCTURE

```
./
├── miniprogram/           ← Mini-program source (miniprogramRoot)
│   ├── pages/
│   │   ├── calendar/      # Main week-view calendar (primary UI)
│   │   ├── auth/          # Login + registration (login, register)
│   │   ├── booking/       # Booking form (stub — redirects to calendar)
│   │   ├── profile/       # User profile hub (index, bookings, stats, privacy)
│   │   ├── waitlist/      # User waitlist management
│   │   ├── legal/         # Legal documents (agreement, privacy)
│   │   └── admin/         # Admin: 13 sub-pages (reviews, maintenance, projects, users, stats, privacy, governance) → AGENTS.md
│   ├── components/        # 5 reusable components
│   ├── custom-tab-bar/    # Custom text-only tab bar (3 tabs)
│   ├── styles/            # Global stylesheets (tokens, base, components, calendar)
│   └── utils/             # Shared utilities (api, date, status, tabbar)
├── cloudfunctions/        # 62 local function dirs (57 in deploy manifest) → AGENTS.md
├── docs/                  # Business baseline v2, style guide, audit plan, impl design
├── legacy-wechat-demo/    # Archived WeChat demo (tracked reference only)
├── project.config.json    # WeChat DevTools project config
├── cloudbaserc.json       # CloudBase CLI deployment config
├── .eslintrc.js           # Root ESLint config
└── package.json           # Root dev deps (eslint only)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| App entry / global state | `miniprogram/app.js` | `App()`, cloud init, `globalData`, `isAdmin()` / `isApprovedUser()` / `needsLegalAcceptance()` |
| Page registry / tab config | `miniprogram/app.json` | 24 pages, custom tabBar (3 tabs: 周历/我的/管理) |
| Config (envId, host) | `miniprogram/config.js` | Cloud env ID, request host |
| Design tokens | `miniprogram/styles/tokens.wxss` | All colors, fonts, spacing, radii — hardcoded hex ONLY here |
| Shared UI classes | `miniprogram/styles/components.wxss` | `.card`, `.list-card`, `.button--*`, `.surface-section`, `.status-tag--*` |
| Cloud function wrapper | `miniprogram/utils/api.js` | `callFunction(name, data)` — ALL cloud calls go through this |
| Status definitions | `miniprogram/utils/status.js` | 9 booking + 4 registration states, calendar cell CSS mapping |
| Date/time logic | `miniprogram/utils/date.js` | Week math, working hours (09:00–18:00), cell range building |
| Tab bar selection | `miniprogram/utils/tabbar.js` | `setTabBarSelected(page, index)` |
| Business rules (authoritative) | `docs/execution-baseline-v2.md` | v2 baseline — supersedes all other docs |
| Visual specs | `docs/style-guide.md` | Theme tokens, component contracts, acceptance checklist |
| Privacy/audit compliance | `docs/audit-compliance-optimization-plan.md` | Forbidden data fields, content safety rules |
| v1 design reference (historical) | `docs/implementation-design.md` | Deprecated — only for understanding existing v1 code |
| Cloud function deployment | `cloudbaserc.json` | 57 deployed functions, all Nodejs18.15, default 15s timeout (`exportOperationalData`: 60s) |
| Cloud functions source | `cloudfunctions/` | Backend logic — see `cloudfunctions/AGENTS.md` |
| Admin pages | `miniprogram/pages/admin/` | 13 sub-pages — see `miniprogram/pages/admin/AGENTS.md` |

## CONVENTIONS

- **Pure JS, CommonJS only** — `require`/`module.exports`, no ES modules, no TypeScript
- **All cloud calls via `utils/api.js`** — never call `wx.cloud.callFunction` directly
- **Data loaded in `onShow()`** — pages reload on every visibility, not just `onLoad()`
- **Page file pattern** — `pages/<feature>/<subpage>/index.{js,json,wxml,wxss}` (all 4 files always present)
- **Cloud function pattern** — `index.main` handler, `{ success, data, error }` response, self-contained (no shared utils)
- **Admin guard** — check `getApp().isAdmin()` before sensitive operations; server-side re-verifies role. Also check `needsLegalAcceptance()` and account status (`isApprovedUser()`) before allowing bookings.
- **CSS token system** — `tokens.wxss` → `base.wxss` → `components.wxss` import chain; page WXSS for page-specific only
- **ESLint** — root config is `.eslintrc.js` + `.eslintignore`; `npm run lint` is available but currently reports repo-wide legacy violations and should be treated as an audit signal, not a green gate

## ANTI-PATTERNS (THIS PROJECT)

### Deprecated designs (from `docs/execution-baseline-v2.md` §3)
Must NOT implement: collecting phone/email/studentId/college/supervisor, storing WeChat nickname/avatar, displaying `openid` on client, uploading proof images, long-press drag-to-select, atomized hourly bookings, public calendar showing names/notes, user rankings, icon-based navigation, SMS/email notifications.

### Visual anti-patterns (from `docs/style-guide.md`)
No images, illustrations, decorative icons, icon grids, gradients, animations, card nesting, theme-color hardcoding outside `tokens.wxss`, page title duplication with native nav bar.

### Privacy/security
Never return raw DB records to client (field whitelists only), never trust client time (use server time), never expose `openid`/names/notes in public APIs, never skip content safety checks on user text input, and fail closed when the content safety API is unavailable.

### Code hygiene
- Only lint suppression: `cloudfunctions/openapi/index.js:54` (`// eslint-disable-next-line`)
- No TODO/FIXME/HACK in source (codebase is clean)

## COMMANDS

```bash
npm install          # Install root dev dependencies (eslint)
npm run lint         # Run ESLint audit (currently reports existing repo-wide legacy issues)
```

**Cloud function deploy:**
```bash
tcb fn deploy <function-name> --dir cloudfunctions/<function-name> -e <env-id>
```

**Build & preview:** Open in WeChat Developer Tools → Tools → Build npm → compile on save (hot reload enabled). Upload via IDE UI.

> No CI/CD, no automated tests, no Makefile. Build/deploy entirely GUI-based via WeChat DevTools.

## NOTES

- `miniprogramRoot` is `miniprogram/` — app files are NOT at repo root
- `booking/form` is a 7-line stub that redirects to calendar tab; safe to remove
- `legacy-wechat-demo/` is a tracked archived reference directory and should not be treated as active app code
- LSP unavailable (no TypeScript in project)
- All cloud functions are self-contained — no shared `utils/` directory among them
- `project.private.config.json` is gitignored and contains developer-local settings
