# cloudfunctions/ — CloudBase Backend

WeChat CloudBase cloud functions. Node.js 18.15 runtime, 15s timeout. All self-contained (no shared utils directory). Env: `cloud1-d9goiq7y767dbd158`.

## OVERVIEW

71 cloud functions. Every function: `index.main` handler, `wx-server-sdk`, inline `ok()`/`fail()` helpers. Auth functions verify `openid` from `wxContext`. Admin functions re-verify role.

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

### Project Management
| Function | Role |
|----------|------|
| `listProjects` | List projects (active/inactive) |
| `createProject` | Admin creates project with name + abbreviation |
| `updateProject` | Admin updates project name/abbreviation |
| `searchProjects` | User searches projects (min 2 chars, max 5 results) |
| `submitProjectApplication` | User submits new project proposal |
| `reviewProjectApplication` | Admin approves/rejects project application |
| `confirmApprovedProject` | User confirms final project info after admin approval |
| `setProjectStatus` | Admin activates/deactivates a project |
| `checkProjectSimilarity` | Check proposed name/abbr for duplicates |
| `syncProjectDisplayCaches` | Update booking/slot display caches after project rename |
| `listProjectApplications` | Admin lists pending project applications |
| `requestProjectChange` | User requests project change (re-approval required) |

### User Lifecycle
| Function | Role |
|----------|------|
| `suspendUser` | Admin suspends user (cancels future bookings, blocks operations) |
| `restoreUser` | Admin restores suspended user |
| `deleteAccount` | User initiates account deletion workflow |

### Privacy &amp; Legal
| Function | Role |
|----------|------|
| `getLegalDocuments` | Return current agreement + privacy policy versions and text |
| `acceptLegalDocuments` | Record user acceptance of current legal documents |
| `submitPrivacyRequest` | User submits structured privacy request (query/correct/delete/withdraw/complaint) |
| `listMyPrivacyRequests` | User views their privacy request status |
| `listPrivacyRequests` | Admin lists pending privacy requests |
| `processPrivacyRequest` | Admin processes a privacy request |

### V2 Booking &amp; Review
| Function | Role |
|----------|------|
| `createBookingV2` | Create booking with multi-segment model, requestId idempotency |
| `cancelBookingV2` | Cancel booking with 12-hour rule, segments model |
| `reviewBookingV2` | Admin reviews pending booking |
| `reviewCancelV2` | Admin reviews cancellation request |
| `submitRegistrationV2` | Submit registration with project association |
| `reviewRegistrationV2` | Admin reviews registration application |
| `confirmWaitlistV2` | Confirm waitlist → booking conversion |

### Data Queries
| Function | Role | Access |
|----------|------|--------|
| `getCalendarBookings` | Weekly public calendar data | Public |
| `listMaintenanceSlots` | All active maintenance slots | Public |
| `listRestrictedSlots` | All active restricted slots | Public |
| `listMyBookings` | User's bookings (filterable) | Self |
| `getUserStats` | User's usage statistics | Self |
| `getAdminDashboard` | Dashboard counts | Admin |
| `getAdminStats` | Detailed usage statistics (monthly + working/non-working hours only) | Admin |
| `listBookingReviews` | Pending booking reviews | Admin |
| `listCancelReviews` | Pending cancel reviews | Admin |
| `listRegistrationReviews` | Pending registrations | Admin |
| `listUsers` | All users | Admin |

### Data &amp; Calendar
| Function | Role | Access |
|----------|------|--------|
| `getPublicCalendar` | Weekly public calendar with field whitelist | Public |
| `getMyBookingDetail` | User's full booking detail with timeline | Self |
| `getAdminBookingDetail` | Admin booking detail with current user name | Admin |
| `getSettings` | Get system settings (hours, versions, service mode) | Public (limited) |

### Settings &amp; Maintenance
| Function | Role |
|----------|------|
| `updateSettings` | Admin updates working hours, agreement versions, service mode |
| `scanSettingsVersion` | Detect rules version changes, trigger migration |
| `exportOperationalData` | Admin exports anonymized operational data to a temporary cloud file |

### Background Tasks
| Function | Role |
|----------|------|
| `expireBookingReviews` | Auto-timeout pending reviews past start time |
| `expireCancelReviews` | Auto-reject cancel reviews past start time |
| `reconcileWaitlists` | Process waitlist queue, handle timeouts and succession |
| `processDeletionTasks` | Execute account deletion steps idempotently |
| `generateDailyStats` | Generate anonymous daily usage statistics |
| `cleanupRetentionData` | Enforce 30/90/365-day data retention policies |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Deployment config | `../cloudbaserc.json` | 67 deployed functions, Nodejs18.15, exportOperationalData uses 60s timeout |
| User model &amp; auth | `login/index.js`, `submitRegistration/index.js` | Registration form fields, role assignment |
| V2 user model &amp; auth | `submitRegistrationV2/index.js` | Registration with project association |
| Booking conflict logic | `createBooking/index.js` | Maintenance/restriction/working-hour checks |
| V2 booking logic | `createBookingV2/index.js` | Multi-segment model, requestId idempotency |
| Cancel threshold | `cancelBooking/index.js` | 12-hour rule; `cancel_pending` vs direct cancel |
| V2 cancel logic | `cancelBookingV2/index.js` | 12-hour rule, segments model |
| Waitlist conversion | `confirmWaitlist/index.js` | Atomic confirm → booking flow |
| Review audit trail | `reviewBooking/`, `reviewCancel/`, `reviewRegistration/` | All write to `review_logs` collection |
| Calendar data assembly | `getCalendarBookings/index.js` | Public weekly view with field whitelist |
| V2 public calendar | `getPublicCalendar/index.js` | Weekly view, strict field whitelist |
| Booking detail | `getMyBookingDetail/index.js`, `getAdminBookingDetail/index.js` | User vs admin detail views |
| Admin stats | `getAdminStats/index.js` | Monthly aggregation + working/non-working hour totals |
| Project management | `createProject/`, `submitProjectApplication/`, `reviewProjectApplication/` | Full project lifecycle |
| Privacy requests | `submitPrivacyRequest/`, `listPrivacyRequests/`, `processPrivacyRequest/` | Structured privacy workflow |
| Legal documents | `getLegalDocuments/`, `acceptLegalDocuments/` | Agreement + privacy policy versioning |
| User lifecycle | `suspendUser/`, `restoreUser/`, `deleteAccount/` | Suspension, restoration, deletion |
| Settings | `getSettings/`, `updateSettings/`, `scanSettingsVersion/` | System configuration, version migration |
| Background tasks | `expireBookingReviews/`, `reconcileWaitlists/`, `cleanupRetentionData/` | Scheduled maintenance jobs |
| Operational export | `exportOperationalData/index.js` | Admin-only anonymized JSON export, 60s timeout |

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
- **Never** skip content safety checks on user text (name, remark, reason, project name/abbr, etc.)
- **Never** create shared utils — each function is intentionally self-contained

## NOTES

- All functions use `wx-server-sdk` (`latest` or `~2.5.3`)
- `exportOperationalData` has a 60-second timeout — the only function exceeding the default 15s
- Only lint suppression in codebase is at `openapi/index.js:54`
