# miniprogram/pages/admin/ — Admin Section

Admin-only pages (tab 2: 管理). Registration review, booking review, cancel review, maintenance, restricted slots, user management, stats.

## OVERVIEW

8 admin pages, all gated by `getApp().isAdmin()`. Shared patterns: `onShow()` data reload, `theme-modal` for reject reasons, `status-tag` + `empty-state` for UI.

## STRUCTURE

```
pages/admin/
├── index/              # Admin hub with 7 nav cards + dashboard stats
├── user-review/        # Review registration applications
├── booking-review/     # Review special-time bookings (night/weekend/restricted)
├── cancel-review/      # Review cancellation requests (<12h before start)
├── maintenance/        # Create/delete maintenance slots (blocks all bookings)
├── restricted/         # Create/delete restricted slots (requires review)
├── users/              # List all users with registration status
└── stats/              # Usage statistics (by user, by month)
```

## WHERE TO LOOK

| Page | Cloud Functions | Key UI |
|------|----------------|--------|
| `index/` | `getAdminDashboard` | 7 nav cards, 4 stat counters |
| `user-review/` | `listRegistrationReviews`, `reviewRegistration` | List + approve/reject with reason modal |
| `booking-review/` | `listBookingReviews`, `reviewBooking` | List + approve/reject with reason modal |
| `cancel-review/` | `listCancelReviews`, `reviewCancel` | List + approve/reject |
| `maintenance/` | `createMaintenance`, `listMaintenanceSlots` | Create form + list with delete |
| `restricted/` | `createRestrictedSlot`, `listRestrictedSlots` | Create form + list with delete |
| `users/` | `listUsers` | User list with `status-tag` |
| `stats/` | `getAdminStats` | Per-user hours, monthly breakdown |

## CONVENTIONS

- **Auth double-check**: Both client-side (`getApp().isAdmin()`) and server-side (cloud function verifies role)
- **Review flow**: List → tap item → detail view → approve/reject (never inline actions on list rows)
- **Reject reason**: Via `theme-modal` with optional text input (选填)
- **Data refresh**: `onShow()` reloads list after any review action
- **Error handling**: All cloud calls use `utils/api.js` → `callFunction()`, errors via `api.showError()`

## ANTI-PATTERNS

- **Never** perform review actions inline in list rows — always navigate to detail first (v2 target)
- **Never** skip server-side role re-verification in cloud functions
- **Never** expose reviewed-by admin name to non-admin users in review results
- **Never** show personal stats (name, project) in admin stats page (v2 target — current code still has user-dimension stats)
