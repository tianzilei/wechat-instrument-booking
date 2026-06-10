# cloudfunctions/ — CloudBase Backend

WeChat CloudBase cloud functions. Node.js 18.15 runtime, 15s timeout. All self-contained (no shared utils directory). Env: `cloud1-d9goiq7y767dbd158`.

## OVERVIEW

25 deployed business functions + 5 demo/utility. Every function: `index.main` handler, `wx-server-sdk`, inline `ok()`/`fail()` helpers. Auth functions verify `openid` from `wxContext`. Admin functions re-verify role.

## STRUCTURE

### Auth &amp; Registration
| Function | Role |
|----------|------|
| `login` | First login creates user doc; returns profile + role |
| `submitRegistration` | Submit registration form for admin approval |
| `reviewRegistration` | Admin approve/reject registration |

### Booking Lifecycle
| Function | Role |
|----------|------|
| `createBooking` | Create booking; auto-confirm normal, flag special for review |
| `cancelBooking` | Cancel; near-term (&lt;12h) enters `cancel_pending` |
| `reviewBooking` | Admin approve/reject pending booking |
| `reviewCancel` | Admin approve/reject cancellation |

### Waitlist
| Function | Role |
|----------|------|
| `joinWaitlist` | Join waitlist for occupied slot |
| `cancelWaitlist` | Cancel own waitlist |
| `confirmWaitlist` | Confirm/decline available slot; converts to booking |
| `listMyWaitlists` | User's waitlist entries |

### Slot Management
| Function | Role |
|----------|------|
| `createMaintenance` | Admin creates maintenance slot; cancels conflicting bookings |
| `deleteMaintenance` | Admin soft-deletes maintenance |
| `createRestrictedSlot` | Admin creates restricted slot (needs approval) |
| `deleteRestrictedSlot` | Admin soft-deletes restricted slot |

### Data Queries
| Function | Role | Access |
|----------|------|--------|
| `getCalendarBookings` | Weekly public calendar data | Public |
| `listMaintenanceSlots` | All active maintenance slots | Public |
| `listRestrictedSlots` | All active restricted slots | Public |
| `listMyBookings` | User's bookings (filterable) | Self |
| `getUserStats` | User's usage statistics | Self |
| `getAdminDashboard` | Dashboard counts | Admin |
| `getAdminStats` | Detailed usage statistics | Admin |
| `listBookingReviews` | Pending booking reviews | Admin |
| `listCancelReviews` | Pending cancel reviews | Admin |
| `listRegistrationReviews` | Pending registrations | Admin |
| `listUsers` | All users | Admin |

### Demo/Utility (not deployed via cloudbaserc.json)
| Function | Purpose |
|----------|---------|
| `getServerDataDemo` | Boilerplate demo |
| `getTempFileURL` | Convert cloud file IDs to temp URLs |
| `openapi` | WeChat OpenAPI demo (template msg, wxacode) |
| `wxContext` | Debug: return wx context info |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Deployment config | `../cloudbaserc.json` | 25 functions, all Nodejs18.15, 15s timeout |
| User model &amp; auth | `login/index.js`, `submitRegistration/index.js` | Registration form fields, role assignment |
| Booking conflict logic | `createBooking/index.js` | Maintenance/restriction/working-hour checks |
| Cancel threshold | `cancelBooking/index.js` | 12-hour rule; `cancel_pending` vs direct cancel |
| Waitlist conversion | `confirmWaitlist/index.js` | Atomic confirm → booking flow |
| Review audit trail | `reviewBooking/`, `reviewCancel/`, `reviewRegistration/` | All write to `review_logs` collection |
| Calendar data assembly | `getCalendarBookings/index.js` | Public weekly view with field whitelist |
| Admin stats | `getAdminStats/index.js` | Per-user hours, monthly aggregation |

## CONVENTIONS

- **Self-contained**: Each function has its own `ok()`/`fail()`/`isAdmin()` helpers. No shared utils.
- **Response format**: `{ success: bool, data: {}, error: { code, message } }`
- **Auth**: Extract `openid` from `cloud.getWXContext().OPENID`, check user doc in DB
- **Admin guard**: Re-verify `user.role === 'admin'` on every admin operation (trust no client)
- **Field whitelist**: Never return raw DB records; always `.field({...})` filter
- **Server time**: Use `new Date()` in cloud functions; never trust client timestamps
- **Init**: Most use `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`

## ANTI-PATTERNS

- **Never** trust client role — always re-verify in cloud function
- **Never** return raw DB records — use field whitelists (`.field()`)
- **Never** trust client time — use server `new Date()` for validation
- **Never** log PII (openid, names, notes, reasons) in cloud function logs
- **Never** skip content safety checks on user text input before DB write
- **Never** create shared utils — each function is intentionally self-contained

## NOTES

- `confirmWaitlist` is present in code but NOT in `cloudbaserc.json` — deploy manually via IDE
- `openapi` and `wxContext` are demo/debug functions, not used in production
- Only lint suppression in codebase is at `openapi/index.js:54`
- All functions use `wx-server-sdk` (`latest` or `~2.5.3`)
