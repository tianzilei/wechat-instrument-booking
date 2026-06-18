# Code Audit Report

Date: 2026-06-18  
Repository: `wechat-instrument-booking`  
Scope: WeChat Mini-Program frontend, CloudBase cloud functions, deployment manifest, project conventions, privacy/security contracts, and v2 business baseline alignment.

## Executive Summary

The codebase is syntactically valid and the major CloudBase functions consistently use server-side role checks, field whitelists in many list APIs, and content-safety checks on most free-text writes. The highest-risk gaps are not parse or build failures; they are contract violations around privacy, booking conflict logic, and incomplete v2 workflows.

Priority remediation should start with:

1. Public calendar leakage of real booking IDs and admin calendar names.
2. Multi-segment conflict checks in `createBookingV2`.
3. Missing waitlist creation flow.
4. Frontend rejection/collapse of non-contiguous multi-segment bookings.

`npm run lint` could not be executed because `eslint` is not installed locally in `node_modules`.

## Findings

### Critical: Public Calendar Returns True Booking IDs

Files:

- `cloudfunctions/getPublicCalendar/index.js:115`
- `cloudfunctions/getPublicCalendar/index.js:118`
- `cloudfunctions/getPublicCalendar/index.js:128`
- `cloudfunctions/getPublicCalendar/index.js:131`
- `miniprogram/pages/calendar/index.js:140`

`getPublicCalendar` is a public calendar endpoint but returns `bookingId: item._id`, and `publicRenderId` is also derived from the real document id. The frontend then stores `slot.bookingId || slot.publicRenderId` as the calendar item booking id.

This violates the v2 baseline and project instructions that public APIs must not expose true booking IDs. It also makes document IDs available to guests and regular users, enabling probing against detail endpoints even if those endpoints later deny access.

Recommended fix:

- For non-admin callers, omit `bookingId` entirely and use an opaque non-document public render key.
- For admin callers, return a real `bookingId` only if needed for detail navigation.
- Do not derive `publicRenderId` from raw `_id`; use a per-response stable synthetic key such as `slot-${index}` or a hash that cannot be used as a DB document id.

### High: Admin Calendar Displays User Names by Default

Files:

- `cloudfunctions/getPublicCalendar/index.js:96`
- `cloudfunctions/getPublicCalendar/index.js:117`
- `cloudfunctions/getPublicCalendar/index.js:130`
- `miniprogram/components/calendar-grid/index.js:104`

For admin callers, `getPublicCalendar` fetches user names and returns `userName` in each slot. The calendar grid renders this as `subtext`, so the admin week grid displays names directly.

The v2 baseline says admin calendar cells should not show names by default; names should be available only through the admin detail API after clicking a booking. This is a privacy minimization issue.

Recommended fix:

- Remove `userName` from `getPublicCalendar`.
- Keep names in `getAdminBookingDetail` only.
- If admin needs a visual distinction, use status/project abbreviation without personal names.

### High: Multi-Segment Conflict Query Is Likely Malformed

Files:

- `cloudfunctions/createBookingV2/index.js:102`
- `cloudfunctions/createBookingV2/index.js:113`
- `cloudfunctions/createBookingV2/index.js:114`
- `cloudfunctions/createBookingV2/index.js:119`
- `cloudfunctions/createBookingV2/index.js:131`
- `cloudfunctions/createBookingV2/index.js:132`
- `cloudfunctions/createBookingV2/index.js:300`
- `cloudfunctions/createBookingV2/index.js:303`

`anyBookingConflict()` and `anyProjectConflict()` build `timeFilter` as either a normal object or `_.or(allConditions)`, then spread it into a normal query object:

```js
const timeFilter = allConditions.length === 1 ? allConditions[0] : _.or(allConditions)
const query = { status: _.in(ACTIVE_STATUSES), _id: ..., ...timeFilter }
```

CloudBase examples and nearby code use `.where(_.or(conditions))` directly, with shared filters included inside each condition or via an explicit logical composition. Spreading a command object into a plain object is fragile and may drop or corrupt the OR condition. In the worst case, this can either reject valid bookings whenever any active booking exists, or miss overlapping bookings for multi-segment requests.

Recommended fix:

- Build each OR branch with `status`, `_id`, and time predicates included.
- Or use an explicit `_.and([sharedFilter, _.or(timeConditions)])` pattern if supported by CloudBase.
- Add a manual or automated concurrent booking test for two users submitting overlapping but non-identical multi-segment requests.

### High: Waitlist Creation Is Missing

Files/signals:

- `miniprogram/pages/calendar/index.js:296`
- `miniprogram/pages/waitlist/index/index.js`
- `cloudbaserc.json`

The app has waitlist listing and confirmation, and the backend has `confirmWaitlistV2` and `reconcileWaitlists`, but there is no active `joinWaitlist` / `createWaitlist` function and no source search hit for `collection('waitlists').add` or `status: 'waitlisted'`.

The calendar also ignores occupied cells for regular users:

```js
if (cellData.status !== 'available') return
```

This means users cannot join a waitlist from occupied slots, despite the v2 baseline requiring single-hour and whole-order waitlist entry.

Recommended fix:

- Add a `createWaitlistV2` cloud function with account, legal, service-mode, maintenance, duplicate, and project checks.
- Add the function to `cloudbaserc.json`.
- Update calendar occupied-cell interaction for approved users to show a waitlist action.
- Ensure waitlist creation uses the same normalized `scheduleKey` semantics as booking creation.

### High: Non-Contiguous Multi-Segment Booking Is Blocked

Files:

- `miniprogram/components/calendar-grid/index.js:346`
- `miniprogram/components/calendar-grid/index.js:349`
- `miniprogram/components/calendar-grid/index.js:354`
- `miniprogram/components/calendar-grid/index.js:355`
- `miniprogram/components/calendar-grid/index.js:356`
- `miniprogram/pages/calendar/index.js:337`

The v2 baseline allows multiple non-contiguous segments in a single booking within the same natural week. The component rejects any non-contiguous selection with "请选择连续时间段", then emits only `startCell` and `endCell`. The calendar submit path sends one continuous segment:

```js
segments: [{ startAt: range.startAt.toISOString(), endAt: range.endAt.toISOString() }]
```

This prevents a core v2 booking model from being used. If the continuity check is removed without changing submit logic, disjoint selections would be incorrectly collapsed into one continuous booking.

Recommended fix:

- Emit the full `selectedCells` list.
- Convert selected cells into normalized segment arrays.
- Submit all segments to `createBookingV2`.
- Validate same-week selection in the frontend for user feedback, while keeping server validation authoritative.

### Medium: Server Enforces a Segment Count Cap Contradicting Baseline

File:

- `cloudfunctions/createBookingV2/index.js:221`

The server rejects bookings with more than 10 raw segments:

```js
if (event.segments.length > 10) return fail(...)
```

The v2 baseline says single booking duration and cell count are not capped. This may be a pragmatic safety limit, but it is undocumented and contradicts the acceptance criteria.

Recommended fix:

- Either remove the cap or document and align the product baseline.
- If a defensive cap is retained, apply it after normalization and return a product-approved error message.

### Medium: Admin Review Pages Still Perform Inline Actions

Files:

- `miniprogram/pages/admin/booking-review/index.wxml:13`
- `miniprogram/pages/admin/booking-review/index.wxml:14`
- `miniprogram/pages/admin/cancel-review/index.wxml:16`
- `miniprogram/pages/admin/cancel-review/index.wxml:17`
- `miniprogram/pages/admin/cancel-review/index.wxml:34`
- `miniprogram/pages/admin/cancel-review/index.wxml:35`
- `miniprogram/pages/admin/project-review/index.wxml:12`
- `miniprogram/pages/admin/project-review/index.wxml:13`
- `miniprogram/pages/admin/rule-review/index.wxml:12`
- `miniprogram/pages/admin/rule-review/index.wxml:13`
- `miniprogram/pages/admin/user-review/index.wxml:12`
- `miniprogram/pages/admin/user-review/index.wxml:13`
- `miniprogram/pages/admin/user-review/index.wxml:27`
- `miniprogram/pages/admin/user-review/index.wxml:28`

Project instructions require review lists to navigate to detail before approve/reject actions. Multiple list pages still include direct approve/reject buttons.

Recommended fix:

- Keep list rows summary-only.
- Route all booking and cancel reviews through `admin/booking-detail`.
- Add or reuse detail pages for registration, project, privacy, and rule-review actions if the same rule applies to those workflows.

### Medium: Public Calendar Input Is Not Validated

File:

- `cloudfunctions/getPublicCalendar/index.js:16`
- `cloudfunctions/getPublicCalendar/index.js:51`
- `cloudfunctions/getPublicCalendar/index.js:143`

`event.weekStartDate` is parsed directly. Missing or malformed input can produce `Invalid Date` and feed invalid values into database comparisons. The function also returns the original event value as `weekStart`.

Recommended fix:

- Validate `YYYY-MM-DD` format.
- Reject invalid dates with `{ success: false, error: { code: 'INVALID_PARAMS', ... } }`.
- Normalize the returned week start to a validated date string.

### Low: `app.js` Bypasses the Shared API Wrapper

File:

- `miniprogram/app.js:24`

Project instructions require all cloud calls through `miniprogram/utils/api.js`. `refreshSession()` calls `wx.cloud.callFunction` directly.

Recommended fix:

- Route the login call through the shared API wrapper or provide a clearly documented exception for app bootstrap.
- If using the wrapper, preserve the existing `identified: false` handling for first-time visitors.

### Low: Hardcoded Colors Outside Token File

File:

- `miniprogram/custom-tab-bar/index.wxss:11`
- `miniprogram/custom-tab-bar/index.wxss:12`
- `miniprogram/custom-tab-bar/index.wxss:20`
- `miniprogram/custom-tab-bar/index.wxss:24`

The custom tab bar hardcodes hex colors outside `styles/tokens.wxss`, violating the style guide.

Recommended fix:

- Replace hardcoded colors with `var(--color-...)` tokens.

### Low: Remark Length Contract Mismatch

Files:

- `miniprogram/components/time-range-sheet/index.wxml:13`
- `cloudfunctions/createBookingV2/index.js:277`

The frontend says booking remarks are limited to 100 characters and enforces `maxlength="100"`, while the server accepts up to 500 characters. The baseline mentions 100 characters.

Recommended fix:

- Align the server limit to 100, or update the baseline and frontend copy together.

### Low: Undeployed Demo/Compatibility Functions Remain in Source

Manifest check:

- Present in `cloudfunctions/` but not deployed: `confirmWaitlist`, `getServerDataDemo`, `getTempFileURL`, `openapi`, `wxContext`

This matches project notes, but keeping demo/openapi helpers in the active source tree increases accidental deployment risk.

Recommended fix:

- Keep them explicitly excluded from `cloudbaserc.json`.
- Consider moving demos to an archived directory or adding clear README warnings in each undeployed function.

## Style Guide Frontend Audit

Scope: static review of `miniprogram/` against `docs/style-guide.md`, especially sections 2, 5-16, and the visual acceptance checklist in section 19.

### High: Modal Overlay Click Closes Destructive Confirmation Dialogs

Files:

- `miniprogram/components/theme-modal/index.wxml:1`
- `miniprogram/components/theme-modal/index.wxml:14`
- `miniprogram/components/theme-modal/index.wxml:15`
- `miniprogram/pages/admin/maintenance/index.wxml:55`
- `miniprogram/pages/admin/users/index.wxml:18`
- `miniprogram/pages/profile/bookings/index.wxml:20`

`theme-modal` closes when the mask is tapped because the root mask binds `catchtap="onCancel"`. The style guide says dangerous or blocking important-change dialogs must not be dismissed through the overlay, and every dialog should provide an explicit cancel or close operation.

This component is reused for destructive or sensitive flows such as deleting maintenance slots, suspending users, rejecting reviews, and cancelling bookings. Overlay dismissal can make a high-stakes dialog behave like a transient popover rather than a controlled confirmation.

Recommended fix:

- Add a component property such as `closeOnMask`.
- Default it to `false` for important confirmations, destructive actions, and review decisions.
- Keep explicit `取消` available in the action area.

### High: Global Button Styles Truncate Text Instead of Wrapping

Files:

- `miniprogram/styles/base.wxss:18`
- `miniprogram/styles/base.wxss:26`
- `miniprogram/styles/base.wxss:28`
- `miniprogram/styles/base.wxss:29`
- `miniprogram/styles/components.wxss:38`
- `miniprogram/styles/components.wxss:49`
- `miniprogram/styles/components.wxss:52`
- `miniprogram/styles/components.wxss:53`
- `miniprogram/components/theme-modal/index.wxss:61`
- `miniprogram/components/theme-modal/index.wxss:73`
- `miniprogram/components/theme-modal/index.wxss:75`
- `miniprogram/components/theme-modal/index.wxss:76`

The style guide requires buttons and modal actions to remain readable on narrow screens and with system font scaling. Current shared button rules force `white-space: nowrap`, hide overflow, and ellipsize text globally.

This affects all pages and is especially risky for confirmation labels such as "同意协议并继续", "提交课题申请", "同意取消", "暂停账号", and modal danger actions. The UI may hide the exact action the user is confirming.

Recommended fix:

- Allow button text to wrap by default while preserving the required minimum heights.
- For compact action groups, switch to a two-row layout when labels cannot fit.
- Avoid reducing font size below the style-guide token sizes as a workaround.

### High: Booking Bottom Sheet Action Area Is Too Constrained

Files:

- `miniprogram/components/time-range-sheet/index.wxss:33`
- `miniprogram/components/time-range-sheet/index.wxss:43`
- `miniprogram/components/time-range-sheet/index.wxss:88`
- `miniprogram/components/time-range-sheet/index.wxss:94`
- `miniprogram/components/time-range-sheet/index.wxss:95`
- `miniprogram/components/time-range-sheet/index.wxss:111`
- `miniprogram/components/time-range-sheet/index.wxss:113`
- `miniprogram/components/time-range-sheet/index.wxss:114`

The booking sheet keeps title and actions in one header row on normal widths, constrains actions to `288rpx` / `54vw`, and truncates action labels. The style guide requires the booking sheet title and actions to remain visible, and narrow screens may split title/actions into two rows.

This can clip important submit labels such as "提交预约" or review-related copy, especially under font scaling or longer Chinese labels.

Recommended fix:

- Make the action area responsive based on actual available width, not a fixed `288rpx` cap.
- Allow title/action wrapping before truncation.
- Keep the header and action area fixed while only the content region scrolls.

### Medium: Admin Home Uses Floating Dashboard Cards Instead of Restrained List Priority

Files:

- `miniprogram/pages/admin/index/index.wxml:8`
- `miniprogram/pages/admin/index/index.wxml:10`
- `miniprogram/pages/admin/index/index.wxml:11`
- `miniprogram/pages/admin/index/index.wxss:1`
- `miniprogram/pages/admin/index/index.wxss:7`
- `miniprogram/pages/admin/index/index.wxss:12`

The style guide's admin page matrix says the management home should prioritize pending work and avoid large statistics cards or icon-grid-like entry layouts. Current `todoCards` render as a two-column grid of white sections with large `56rpx` count numbers and `224rpx` minimum height.

This visually pulls the admin home toward a dashboard-card layout rather than the quiet operational list style specified by the guide.

Recommended fix:

- Render pending items as a compact list or dense grouped rows.
- Keep counts as secondary row metadata instead of oversized card numerals.
- Use `.surface-section` for a single group, with `.list-card` rows inside.

### Medium: Nested Surface/Card Pattern Appears in Admin Maintenance Focus State

Files:

- `miniprogram/pages/admin/maintenance/index.wxml:29`
- `miniprogram/pages/admin/maintenance/index.wxml:31`
- `miniprogram/pages/admin/maintenance/index.wxml:32`
- `miniprogram/pages/admin/maintenance/index.wxss:20`
- `miniprogram/pages/admin/maintenance/index.wxss:21`
- `miniprogram/pages/admin/maintenance/index.wxss:22`

The style guide forbids card nesting and says `list-card` should remain visually linear: white row, divider only, no independent rounded/shaded row treatment. `slot-card--focus` sits inside a `surface-section` and adds its own semantic background and border color.

The result is a highlighted card-like row inside another white surface. It also uses primary green for a maintenance-focused state, while maintenance has dedicated tokens.

Recommended fix:

- Present the current maintenance item as a normal list row with a status tag, or make the whole section the highlighted surface.
- Use `--color-maintenance` / `--color-maintenance-soft` when the state is maintenance-specific.

### Medium: Page-Specific Stat Cards Recreate Shared Visual System

Files:

- `miniprogram/pages/admin/maintenance-mode/index.wxss:14`
- `miniprogram/pages/admin/maintenance-mode/index.wxss:20`
- `miniprogram/pages/admin/maintenance-mode/index.wxss:23`
- `miniprogram/pages/admin/maintenance-mode/index.wxss:28`
- `miniprogram/pages/admin/maintenance-mode/index.wxss:29`
- `miniprogram/styles/components.wxss:154`
- `miniprogram/styles/components.wxss:162`

The style guide says page WXSS should only contain page-specific layout and should reuse shared components first. `maintenance-mode` redefines `.stat-grid`, `.stat-card`, `.stat-value`, and `.stat-label`, including a larger `48rpx` stat value and `12rpx` radius, while the shared contract defines `36rpx` stat values and `8rpx` card radius.

Recommended fix:

- Use the shared `.stat-grid`, `.stat-card`, `.stat-value`, and `.stat-label` classes.
- If a new semantic statistic variant is required, add it once to `styles/components.wxss`.

### Medium: Calendar Multi-Select Bar Uses Popover Shadow

Files:

- `miniprogram/components/calendar-grid/index.wxss:11`
- `miniprogram/components/calendar-grid/index.wxss:20`
- `miniprogram/components/calendar-grid/index.wxss:21`
- `miniprogram/components/calendar-grid/index.wxss:22`

The style guide allows the calendar multi-select bar to be fixed at the top of the grid, but it prohibits large-area shadow treatment and prefers dividers over floating surfaces. The current bar applies `box-shadow: var(--shadow-popover)`.

Recommended fix:

- Remove the shadow.
- Keep the bar anchored with background color and a single divider.
- Verify it does not overlap the fixed date header or reduce visible calendar rows unexpectedly.

### Medium: Hardcoded Tab Bar Colors Bypass Tokens

Files:

- `miniprogram/custom-tab-bar/index.wxss:11`
- `miniprogram/custom-tab-bar/index.wxss:12`
- `miniprogram/custom-tab-bar/index.wxss:20`
- `miniprogram/custom-tab-bar/index.wxss:24`

The style guide requires theme colors to be maintained in `styles/tokens.wxss`; hardcoded colors outside the token file are disallowed except unavoidable Mini Program configuration cases. The custom tab bar hardcodes border, surface, inactive text, and active text colors.

Recommended fix:

- Replace the hex colors with `var(--color-divider)`, `var(--color-surface)`, `var(--color-text-secondary)`, and `var(--color-primary)`.

### Medium: Inline Review Actions Remain on Admin Review Lists

Files:

- `miniprogram/pages/admin/booking-review/index.wxml:12`
- `miniprogram/pages/admin/booking-review/index.wxml:13`
- `miniprogram/pages/admin/booking-review/index.wxml:14`
- `miniprogram/pages/admin/cancel-review/index.wxml:16`
- `miniprogram/pages/admin/cancel-review/index.wxml:17`
- `miniprogram/pages/admin/cancel-review/index.wxml:34`
- `miniprogram/pages/admin/cancel-review/index.wxml:35`
- `miniprogram/pages/admin/user-review/index.wxml:12`
- `miniprogram/pages/admin/user-review/index.wxml:13`

This is both a workflow and style-guide problem. The page application matrix says review lists should be summary lists, with detail pages handling approval/rejection. Inline approve/reject buttons also make list rows dense and harder to scan.

Recommended fix:

- Make review rows navigable summaries.
- Move approve/reject to a detail page or a consistent fixed action bar.
- Keep rejection reasons in the shared modal after detail confirmation.

### Low: Calendar Selected Cell Adds Decorative Dot Beyond Text State

Files:

- `miniprogram/components/calendar-grid/index.wxml:35`
- `miniprogram/components/calendar-grid/index.wxss:208`
- `miniprogram/components/calendar-grid/index.wxss:213`
- `miniprogram/components/calendar-grid/index.wxss:215`
- `miniprogram/components/calendar-grid/index.wxss:216`

The guide says status should include text and forbids decorative icon-like markers by default. The selected cell already renders the text label "已选", but it also adds a circular pseudo-element marker in the corner.

Recommended fix:

- Remove the pseudo-element dot.
- Keep the `已选` text, border, and soft background as the selected-state signal.

### Low: Static Scan Found No Gradients, Images, or Animations

Command:

```bash
rg -n "linear-gradient|radial-gradient|animation:|transition:|background-image|<image|icon=" miniprogram
```

Result: no matches. This part of the style-guide checklist is currently clean.

## Positive Observations

- All cloud function `index.js` files passed `node --check`.
- Admin cloud functions generally re-verify role server-side.
- Most user free-text writes use `cloud.openapi.security.msgSecCheck` and fail closed.
- Public calendar uses field whitelists for booking, maintenance, and settings queries.
- Deployment manifest has no missing directories for listed functions.

## Verification Performed

Commands/checks run:

```bash
git status --short
rg --files
Get-ChildItem -Recurse -Filter AGENTS.md
npm run lint
Get-ChildItem -Recurse -Filter index.js cloudfunctions | ForEach-Object { node --check $_.FullName }
rg -n "wx\.cloud\.callFunction" miniprogram
rg -n "openid|phone|email|studentId|avatar|nickName|nickname|TODO|FIXME|HACK|console\.log|console\.error" miniprogram cloudfunctions
rg -n "collection\('waitlists'\)\.add|status: 'waitlisted'|joinWaitlist|createWaitlist|addWaitlist" cloudfunctions miniprogram
```

`npm run lint` result:

```text
'eslint' is not recognized as an internal or external command
```

Interpretation: `package.json` defines a lint script, but local dependencies are not installed in this workspace.

## Limitations

- I did not install dependencies or run WeChat Developer Tools.
- I did not deploy or execute CloudBase functions against a live environment.
- No automated test suite exists in the repository.
- Findings are based on static inspection and source-level reasoning.

## Suggested Remediation Order

1. Fix `getPublicCalendar` privacy output: remove true IDs and names for non-detail calendar responses.
2. Fix `createBookingV2` multi-segment conflict queries and add targeted manual/automated conflict tests.
3. Implement `createWaitlistV2` and occupied-cell waitlist entry.
4. Rework multi-select to submit normalized non-contiguous segments.
5. Align admin review list flows with detail-first action rules.
6. Clean up lower-priority convention issues: API wrapper usage, token colors, remark length, stale/demo functions.
