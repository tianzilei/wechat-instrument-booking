# miniprogram/pages/admin/ — Admin Section

Admin-only pages (tab 2: 管理). Registration review, booking review, cancel review, maintenance, user management, project management, privacy requests, and maintenance mode. Restricted-slot management and the old standalone review/stats pages have been retired from active UI.

## OVERVIEW

Current admin pages are all gated by `getApp().isAdmin()`. Shared patterns: `onShow()` data reload, `theme-modal` for reject reasons, `status-tag` + `empty-state` for UI. Project management, privacy request processing, booking rule review, and system-wide maintenance mode are folded into the current hub and detail flows.

## STRUCTURE

```
pages/admin/
├── index/              # Admin hub with dashboard stats + todo counts
├── booking-detail/     # Booking detail and review actions
├── booking-review/     # Review special-time bookings
├── cancel-review/      # Review cancellation requests
├── maintenance/        # Create/delete maintenance slots
├── maintenance-mode/   # Toggle system maintenance mode (blocks all booking)
├── privacy-request-detail/ # Privacy request detail + processing
├── privacy-review/     # Review and process privacy requests
├── project-application-detail/ # Project application detail + review
├── projects/           # Manage project directory (create, edit, activate/deactivate)
├── registration-detail/ # Registration detail + review
├── user-review/        # Review registration applications
└── users/              # List all users, suspend/restore
```

## WHERE TO LOOK

| Page | Cloud Functions | Key UI |
|------|----------------|--------|
| `index/` | `getAdminDashboard` | Dashboard stats + todo counts |
| `booking-detail/` | `getAdminBookingDetail`, `reviewBookingV2`, `reviewCancelV2` | Detail + review action bar |
| `booking-review/` | `listBookingReviews`, `reviewBookingV2` | List + approve/reject with reason modal |
| `cancel-review/` | `listCancelReviews`, `reviewCancelV2` | List + approve/reject |
| `maintenance/` | `createMaintenance`, `listMaintenanceSlots` | Create form + list with delete |
| `maintenance-mode/` | `getSettings`, `updateSettings`, `exportOperationalData`, `getAdminStats` | Toggle, working hours, internal export, aggregated stats |
| `privacy-request-detail/` | `getPrivacyRequestDetail`, `processPrivacyRequest` | Request detail + handling |
| `privacy-review/` | `listPrivacyRequests`, `processPrivacyRequest` | List + process with status flow |
| `project-application-detail/` | `getProjectApplicationDetail`, `reviewProjectApplication` | Application detail + review |
| `projects/` | `listProjects`, `createProject`, `updateProject`, `setProjectStatus` | List + create/edit/activate/deactivate |
| `registration-detail/` | `getRegistrationReviewDetail`, `reviewRegistrationV2` | Registration detail + review |
| `user-review/` | `listRegistrationReviews`, `listProjectApplications`, `reviewRegistrationV2`, `reviewProjectApplication` | Unified registration + project-application intake |
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
- **Never** reintroduce retired standalone entry pages (`project-review/`, `rule-review/`, `stats/`) into `app.json` or the admin hub
