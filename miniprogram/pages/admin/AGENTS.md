# miniprogram/pages/admin/ — Admin Section

Admin-only pages (tab 2: 管理). Registration review, booking review, cancel review, maintenance, restricted slots, user management, stats. v2 adds project management, privacy requests, rule review, and maintenance mode.

## OVERVIEW

13 admin pages, all gated by `getApp().isAdmin()`. Shared patterns: `onShow()` data reload, `theme-modal` for reject reasons, `status-tag` + `empty-state` for UI. v2 added project management, privacy request processing, booking rule review, and system-wide maintenance mode toggle.

## STRUCTURE

```
pages/admin/
├── index/              # Admin hub with dashboard stats + todo counts
├── booking-review/     # Review special-time bookings
├── cancel-review/      # Review cancellation requests
├── maintenance/        # Create/delete maintenance slots
├── maintenance-mode/   # Toggle system maintenance mode (blocks all booking)
├── privacy-review/     # Review and process privacy requests
├── project-review/     # Review project applications
├── projects/           # Manage project directory (create, edit, activate/deactivate)
├── restricted/         # Create/delete restricted slots
├── rule-review/        # Review bookings flagged by rule changes
├── stats/              # Usage statistics
├── user-review/        # Review registration applications
└── users/              # List all users, suspend/restore
```

## WHERE TO LOOK

| Page | Cloud Functions | Key UI |
|------|----------------|--------|
| `index/` | `getAdminDashboard` | Dashboard stats + todo counts |
| `booking-review/` | `listBookingReviews`, `reviewBookingV2` | List + approve/reject with reason modal |
| `cancel-review/` | `listCancelReviews`, `reviewCancelV2` | List + approve/reject |
| `maintenance/` | `createMaintenance`, `listMaintenanceSlots` | Create form + list with delete |
| `maintenance-mode/` | `getSettings`, `updateSettings` | Toggle + status display |
| `privacy-review/` | `listPrivacyRequests`, `processPrivacyRequest` | List + process with status flow |
| `project-review/` | `listProjectApplications`, `reviewProjectApplication` | List + approve/reject |
| `projects/` | `listProjects`, `createProject`, `updateProject`, `setProjectStatus` | List + create/edit/activate/deactivate |
| `restricted/` | `createRestrictedSlot`, `listRestrictedSlots` | Create form + list with delete |
| `rule-review/` | `listBookingReviews` (rule_review_pending), `reviewBookingV2` | List + approve/reject rule-flagged bookings |
| `stats/` | `getAdminStats` | Per-user hours, monthly breakdown |
| `user-review/` | `listRegistrationReviews`, `reviewRegistrationV2` | List + approve/reject with reason modal |
| `users/` | `listUsers`, `suspendUser`, `restoreUser` | User list with `status-tag`, suspend/restore |

## CONVENTIONS

- **Auth double-check**: Both client-side (`getApp().isAdmin()`) and server-side (cloud function verifies role)
- **Review flow**: List → tap item → detail view → approve/reject (never inline actions on list rows)
- **Reject reason**: Via `theme-modal` with optional text input (选填)
- **Data refresh**: `onShow()` reloads list after any review action
- **Maintenance mode**: System-wide toggle via `maintenance-mode/` — when enabled, all booking creation is blocked globally. Not a per-page or per-instrument setting.
- **Error handling**: All cloud calls use `utils/api.js` → `callFunction()`, errors via `api.showError()`

## ANTI-PATTERNS

- **Never** perform review actions inline in list rows — always navigate to detail first (v2 target)
- **Never** skip server-side role re-verification in cloud functions
- **Never** expose reviewed-by admin name to non-admin users in review results
- **Never** show personal stats (name, project) in admin stats page (v2 target — current code still has user-dimension stats)
