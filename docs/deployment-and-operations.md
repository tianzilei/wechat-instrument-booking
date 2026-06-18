# 部署与运维指南

本文说明项目初始化、云函数部署、管理员添加、数据库配置、维护模式和常用 CLI 排障方法。业务规则仍以 `execution-baseline-v2.md` 为准。

## 1. 当前部署范围

- 小程序根目录：`miniprogram/`
- 云函数根目录：`cloudfunctions/`
- 云函数运行时：`Nodejs18.15`
- 部署清单：`cloudbaserc.json`
- 当前部署清单包含 57 个业务云函数。
- `cloudfunctions/` 下共有 62 个目录，以下 5 个是历史兼容、示例或调试目录，不在批量部署清单中：
  - `confirmWaitlist`
  - `getServerDataDemo`
  - `getTempFileURL`
  - `openapi`
  - `wxContext`

不要为了获取 `openid` 而把示例函数部署到生产环境。业务接口不得向客户端返回 `openid`。

## 2. 部署前准备

### 2.1 安装并登录 CloudBase CLI

```bash
npm install -g @cloudbase/cli
tcb login
tcb env list
tcb env use <env-id>
```

也可以不设置默认环境，在每条命令中显式传入 `-e <env-id>`。生产操作推荐显式传入环境 ID，避免误操作其他环境。

### 2.2 核对环境配置

切换环境时至少同步检查以下位置：

| 文件 | 配置 |
| --- | --- |
| `miniprogram/config.js` | 小程序调用的 `envId` |
| `cloudbaserc.json` | CLI 部署使用的 `envId` |
| `project.config.json` | 微信小程序 `appid`、项目根目录和基础库版本 |

发布前确认三处指向同一个目标环境。不要把测试环境的小程序前端连接到生产数据库。

### 2.3 安装本地依赖

```bash
npm install
```

每个云函数都有独立 `package.json`。当前 `wx-server-sdk` 使用 `latest` 且没有锁文件，云端安装结果可能随时间变化。生产环境若要求可重复部署，应先统一固定依赖版本并生成锁文件，再执行部署。

## 3. 数据库初始化

### 3.1 必需集合

在云开发控制台创建以下集合。集合不存在时，相关云函数会执行失败。

| 集合 | 用途 |
| --- | --- |
| `users` | 用户、角色和账号状态 |
| `projects` | 正式课题目录 |
| `project_applications` | 新课题申请 |
| `registration_applications` | 注册申请 |
| `bookings` | 预约记录 |
| `waitlists` | 候补记录 |
| `maintenance_slots` | 维护时段 |
| `restricted_slots` | 受限时段 |
| `settings` | 全局工作时间、维护模式和协议版本 |
| `system_locks` | 预约/候补关键写入互斥锁 |
| `review_logs` | 审核与运维操作记录 |
| `notifications` | 候补通知 |
| `important_events` | 强提醒事件 |
| `privacy_requests` | 隐私请求 |
| `deletion_tasks` | 注销任务 |
| `rule_migration_tasks` | 规则迁移任务 |
| `monthly_stats` | 匿名月度统计 |
| `error_logs` | 可清理的错误日志 |

`perm4` 仅被未部署的示例函数使用，不属于业务集合。

`system_locks` 当前至少会使用文档 ID `booking_schedule_mutex`，由 `createBookingV2` 和 `confirmWaitlistV2` 在关键写入时维护。建议提前创建集合并保留云函数独占写权限。

### 3.2 初始化全局设置

在 `settings` 集合创建文档 ID 为 `global` 的记录：

```js
{
  _id: 'global',
  timezone: 'Asia/Shanghai',
  openStartHour: 9,
  openEndHour: 18,
  maxAdvanceDays: 7,
  rulesVersion: 1,
  processedRulesVersion: 1,
  serviceMode: 'maintenance',
  serviceAgreementVersion: '1.0',
  privacyPolicyVersion: '1.0',
  updatedAt: new Date()
}
```

新环境建议先使用 `maintenance`，完成管理员初始化和验收后再切换为 `normal`。

### 3.3 必要索引

通过云开发控制台的数据库索引页面创建：

| 集合 | 索引 |
| --- | --- |
| `users` | `openid` 唯一；`accountStatus + registrationStatus` |
| `projects` | `normalizedAbbr` 唯一；`status + normalizedName` |
| `project_applications` | `userId + status`；`status + createdAt` |
| `registration_applications` | `userId + status`；`status + createdAt` |
| `bookings` | `userId + firstStartAt`；`status + firstStartAt`；`lastEndAt` |
| `waitlists` | `userId + scheduleKey + status`；`status + createdAt` |
| `privacy_requests` | `userId + createdAt`；`status + createdAt` |
| `important_events` | `userId + readAt + createdAt` |
| `deletion_tasks` | `userId` 唯一；`status + nextRetryAt` |

索引字段顺序必须与表格一致。唯一索引创建失败时，先查找并清理重复数据，不要直接取消唯一约束。

### 3.4 数据库权限

- 小程序客户端不得直接读写业务集合。
- 所有业务访问必须经过云函数。
- 数据库安全规则应默认拒绝客户端读写，仅允许受信任的云函数和控制台运维访问。
- 不要为了调试临时开放 `users`、`bookings`、`settings` 等集合；调试结束后忘记恢复会造成严重数据风险。

## 4. 添加管理员

管理员权限由 `users.role === 'admin'` 决定。所有管理员云函数都会使用当前微信 `OPENID` 再次查询 `users` 集合，不能只修改前端状态。

### 4.1 已存在用户记录时

推荐流程：

1. 让目标用户先在小程序中登录，使运维人员能确认其身份。
2. 在云开发控制台打开 `users` 集合。
3. 根据姓名、课题及线下确认结果找到正确记录，记录文档 `_id`。
4. 将 `role` 修改为 `admin`。
5. 确认 `accountStatus` 为 `active`。
6. 如果管理员也需要使用预约功能，确认 `registrationStatus` 为 `approved`。
7. 让用户在小程序中点击“登录/刷新状态”或重新启动小程序。
8. 进入“管理”页验证权限。

使用 CLI 前先查询候选记录，避免改错人：

```bash
tcb db nosql execute -e <env-id> --json --command \
'[{"TableName":"users","CommandType":"QUERY","Command":"{\"find\":\"users\",\"filter\":{},\"projection\":{\"_id\":1,\"name\":1,\"role\":1,\"registrationStatus\":1,\"accountStatus\":1,\"projectName\":1},\"limit\":100}"}]'
```

确认 `_id` 后授予管理员权限。该操作不改变注册审核状态：

```bash
tcb db nosql execute -e <env-id> --json --command \
'[{"TableName":"users","CommandType":"UPDATE","Command":"{\"update\":\"users\",\"updates\":[{\"q\":{\"_id\":\"<user-document-id>\"},\"u\":{\"$set\":{\"role\":\"admin\",\"accountStatus\":\"active\"},\"$currentDate\":{\"updatedAt\":true}},\"multi\":false}]}"}]'
```

不要为了让管理员能够预约而直接把未审核用户改为 `approved`。预约资格仍应通过注册审核流程获得。

撤销管理员权限时只把 `role` 改回 `user`，不要删除用户记录：

```bash
tcb db nosql execute -e <env-id> --json --command \
'[{"TableName":"users","CommandType":"UPDATE","Command":"{\"update\":\"users\",\"updates\":[{\"q\":{\"_id\":\"<user-document-id>\"},\"u\":{\"$set\":{\"role\":\"user\"},\"$currentDate\":{\"updatedAt\":true}},\"multi\":false}]}"}]'
```

数据库直接授权不会自动写入 `review_logs`。生产环境必须在独立运维记录中登记目标用户、操作者、时间、原因和复核人。

### 4.2 全新环境的首位管理员

全新环境还没有管理员，无法通过管理页授权。需要一次受控的数据库引导：

1. 让管理员本人打开目标环境对应的小程序并完成一次微信身份初始化。
2. 在云开发控制台的登录授权/用户管理中确认该微信身份的 `openid`。不要通过公开接口、截图或聊天转发 `openid`。
3. 在 `users` 集合手动创建记录，并将日期字段使用数据库的日期类型填写。

```js
{
  openid: '<从受信任控制台确认的 OPENID>',
  role: 'admin',
  accountStatus: 'active',
  registrationStatus: 'approved',
  name: '<管理员姓名>',
  projectId: '',
  projectName: '',
  projectAbbr: '',
  agreementVersion: '',
  privacyVersion: '',
  createdAt: new Date(),
  updatedAt: new Date()
}
```

4. 管理员重新登录后，按页面提示同意当前服务协议和隐私政策。
5. 确认“管理”页可访问，再由首位管理员处理其他用户申请。

首位管理员初始化完成后，应由第二名运维人员复核 `openid`、角色和环境 ID。不要长期保留临时引导函数。

## 5. 云函数部署

### 5.1 全量部署

在仓库根目录执行：

```bash
tcb login
tcb fn deploy --all --force -e <env-id>
```

`--all` 只部署 `cloudbaserc.json` 中的 57 个业务函数，不会部署上述 5 个未纳入清单的目录。`--force` 会覆盖云端同名函数，执行前必须确认环境 ID。

### 5.2 单函数部署

```bash
tcb fn deploy <function-name> \
  --dir cloudfunctions/<function-name> \
  --force \
  -e <env-id>
```

修改函数运行时、超时或定时触发器时，先更新 `cloudbaserc.json`，再部署。只在控制台手工修改云端配置会造成配置漂移，下次全量部署可能被覆盖。

### 5.3 部署后核对

```bash
# 应返回 57 个业务函数，且状态均为 Deployment completed
tcb fn list --limit 100 --json -e <env-id>

# 查看单个函数配置
tcb fn detail <function-name> --json -e <env-id>

# 查看最近错误日志
tcb fn log <function-name> --error --limit 20 --json -e <env-id>
```

还需要在云开发控制台核对以下定时任务已存在且启用：

- `expire-booking-reviews-5m`
- `expire-cancel-reviews-5m`
- `reconcile-waitlists-5m`
- `process-deletion-tasks-5m`
- `scan-settings-version-1m`
- `generate-daily-stats`
- `cleanup-retention-data`

### 5.4 CLI 调用限制

`tcb fn invoke` 调用事件型云函数时没有小程序用户的微信 `OPENID` 上下文。因此：

- 可以调用无身份要求的只读函数，例如 `getSettings`。
- 不能用它代替管理员调用 `updateSettings`、审核、暂停用户等函数，这些调用会返回 `PERMISSION_DENIED`。
- 管理操作应通过已登录管理员的小程序执行；紧急情况下才由受信任运维人员直接修改数据库。

只读验证示例：

```bash
tcb fn invoke getSettings --json -e <env-id>
tcb fn invoke getPublicCalendar -d '{"weekStartDate":"2026-06-08"}' --json -e <env-id>
```

## 6. 小程序部署

1. 先部署数据库结构和云函数，不能先发布依赖新接口的前端。
2. 使用微信开发者工具打开仓库根目录。
3. 确认 `miniprogramRoot` 为 `miniprogram/`、`cloudfunctionRoot` 为 `cloudfunctions/`。
4. 确认 `appid`、`miniprogram/config.js` 的环境 ID 和目标环境一致。
5. 编译并测试周历、登录、注册、管理页和预约闭环。
6. 使用真机预览验证，不要只依赖模拟器。
7. 上传小程序代码并填写清晰的版本号和更新说明。
8. 云端验收完成后再结束维护模式。

`project.config.json` 当前使用 `libVersion: latest`。开发者工具和最新基础库可能出现模拟器兼容问题，正式发布前应固定到已经真机验证的基础库版本，不要在发布当天自动切换未知版本。

## 7. 生产更新顺序

已有用户和数据的环境应按以下顺序更新：

1. 记录当前环境 ID、云函数列表、函数更新时间和主要集合数量。
2. 在“管理 → 系统设置”开启维护模式。
3. 确认 `getSettings` 返回 `serviceMode: maintenance`，并验证 `createBookingV2` / `confirmWaitlistV2` 被服务端拒绝。
4. 创建数据库备份或确认可用回滚时间。
5. 创建新增集合和索引，更新最小权限规则。
6. 部署全部云函数并核对 57 个函数状态和定时触发器。
7. 在“管理 → 系统设置”执行一次脱敏运营数据导出，确认导出函数可用并留存发布前快照。
8. 编译、预览并上传新版小程序。
9. 使用管理员和普通用户分别完成真机验收。
10. 清理测试数据并复核管理员角色。
11. 在“管理 → 系统设置”结束维护模式。
12. 再次调用 `getSettings`，确认 `serviceMode: normal`，并验证预约入口恢复可用。

任一步失败都保持维护模式，修复后从失败步骤幂等重跑。不要为恢复服务而重新开放旧版个人信息结构。

## 8. 数据库运维命令

### 8.1 查询全局设置

```bash
tcb db nosql execute -e <env-id> --json --command \
'[{"TableName":"settings","CommandType":"QUERY","Command":"{\"find\":\"settings\",\"filter\":{\"_id\":\"global\"},\"limit\":1}"}]'
```

### 8.2 紧急切换维护模式

正常情况下应由管理员在小程序中操作。仅当管理页不可用且系统必须立即止写时，才直接修改数据库。

开启维护：

```bash
tcb db nosql execute -e <env-id> --json --command \
'[{"TableName":"settings","CommandType":"UPDATE","Command":"{\"update\":\"settings\",\"updates\":[{\"q\":{\"_id\":\"global\"},\"u\":{\"$set\":{\"serviceMode\":\"maintenance\"},\"$currentDate\":{\"updatedAt\":true}},\"multi\":false}]}"}]'
```

恢复服务：

```bash
tcb db nosql execute -e <env-id> --json --command \
'[{"TableName":"settings","CommandType":"UPDATE","Command":"{\"update\":\"settings\",\"updates\":[{\"q\":{\"_id\":\"global\"},\"u\":{\"$set\":{\"serviceMode\":\"normal\"},\"$currentDate\":{\"updatedAt\":true}},\"multi\":false}]}"}]'
```

直接修改后必须调用 `getSettings` 回读验证，并在运维记录中登记操作者、时间和原因。

### 8.3 查询集合数量

```bash
tcb db nosql execute -e <env-id> --json --command \
'[{"TableName":"bookings","CommandType":"COMMAND","Command":"{\"count\":\"bookings\",\"query\":{}}"}]'
```

替换 `bookings` 可检查其他集合。生产更新前后建议记录 `users`、`bookings`、`waitlists`、`projects`、`registration_applications` 和任务集合数量。

### 8.4 回滚能力检查

CloudBase CLI 可查询数据库可回滚时间和集合：

```bash
tcb db nosql backup time --json -e <env-id>
tcb db nosql backup collection --time '<rollback-time>' --json -e <env-id>
tcb db nosql backup task --json -e <env-id>
```

恢复命令会修改云端数据，必须先在测试环境演练并由两人复核。优先恢复到新集合检查，不要直接覆盖生产集合：

```bash
tcb db nosql backup restore \
  --time '<rollback-time>' \
  --tables '[{"OldTableName":"bookings","NewTableName":"bookings_restore_check"}]' \
  --json \
  -e <env-id>
```

## 9. 哪些操作必须在哪里执行

| 操作 | 推荐位置 | 说明 |
| --- | --- | --- |
| 部署全部云函数 | CloudBase CLI | 使用 `cloudbaserc.json` 保持配置一致 |
| 上传小程序代码 | 微信开发者工具 | CLI 不代替小程序上传和提审 |
| 添加首位管理员 | 云开发数据库控制台 | 尚无管理员时只能受控引导 |
| 添加后续管理员 | 数据库控制台或 NoSQL CLI | 必须线下确认身份并按 `_id` 修改 |
| 注册、预约和审核 | 小程序 | 保留微信身份上下文和服务端鉴权 |
| 开关维护模式 | 管理员小程序 | 紧急故障时才直接修改 `settings` |
| 创建集合、索引和安全规则 | 云开发控制台 | 发布前完成，客户端默认拒绝读写 |
| 查看函数状态和日志 | CloudBase CLI/控制台 | 使用 `fn list`、`fn detail`、`fn log` |
| 脱敏运营数据导出 | 管理员小程序 | 生成临时 JSON 文件，不包含用户身份和审计数据 |
| 数据恢复 | CloudBase 控制台/CLI | 高风险，先恢复到新集合验证 |

## 10. 发布后验收清单

- 云端函数数量与 `cloudbaserc.json` 一致，当前应为 67。
- 所有函数状态为 `Deployment completed`。
- 定时触发器存在且没有连续错误。
- `settings/global` 存在，协议版本和工作时间正确。
- 管理员重新登录后能进入管理页，普通用户不能进入。
- 游客只能查看公开周历，不返回姓名、备注或 `openid`。
- 普通用户只能查看自己的预约、候补和隐私请求。
- 预约冲突、维护时段、受限时段和取消审核规则正常。
- 真机完成登录、注册、预约、审核、取消和候补测试。
- 验收结束后删除虚构测试数据。
- 最终确认 `serviceMode` 为 `normal`。

## 11. 常见问题

### CLI 部署成功，但功能仍是旧版本

检查是否部署到了正确环境、函数 `modifyTime` 是否更新、小程序 `config.js` 是否指向同一环境，以及开发者工具是否仍使用旧缓存。

### `tcb fn invoke updateSettings` 返回无权限

这是预期行为。CLI 调用没有微信 `OPENID`，管理员函数会拒绝。请在管理员小程序中执行，或按紧急数据库流程处理。

### 云函数目录有 62 个，但云端只有 57 个

这是当前设计。4 个示例目录不在 `cloudbaserc.json` 中，也不应部署到生产环境。

### 点击 Tab 后开发者工具显示 `Error: timeout`

若堆栈仅位于 `WAServiceMainContext.js`，云函数日志正常且真机不复现，通常是开发者工具与基础库模拟器兼容问题。清缓存、重启工具，并固定到已验证的基础库版本后再测试。

### 后台存在待审核预约，但周历没有显示

先检查预约记录使用的是哪一版时间字段：

- V1 预约使用 `startAt`、`endAt` 和 `projectAbbr`。
- V2 预约使用 `firstStartAt`、`lastEndAt`、`segments` 和 `projectAbbrDisplayCache`。

曾出现过 `createBookingV2` 已写入 V2 字段，但 `getPublicCalendar` 仍只按 V1 的 `startAt/endAt` 查询。结果是管理端按 `status: pending_review` 能找到记录，公开周历的时间范围查询却匹配不到记录，所以页面没有任何待审核格子。这不是前端颜色映射问题，而是云函数的数据模型版本不一致。

当前 `getPublicCalendar` 会：

1. 使用 `firstStartAt/lastEndAt` 查询 V2 预约。
2. 逐个展开状态仍有效的 `segments`，避免不连续时段被渲染成一整段。
3. 保留独立的 `startAt/endAt` 查询以兼容 V1 历史记录。
4. 将 `pending_review`、`cancel_pending` 和 `waitlist_confirming` 映射为待审核占用，将 `confirmed` 映射为已预约占用。

排查时可先查询待审核记录的字段结构，再调用公开周历函数验证返回的 `slots`：

```bash
tcb db nosql execute -e <env-id> --json --command \
'[{"TableName":"bookings","CommandType":"QUERY","Command":"{\"find\":\"bookings\",\"filter\":{\"status\":\"pending_review\"},\"projection\":{\"_id\":1,\"status\":1,\"startAt\":1,\"endAt\":1,\"firstStartAt\":1,\"lastEndAt\":1,\"segments\":1,\"projectAbbrDisplayCache\":1},\"limit\":20}"}]'

tcb fn invoke getPublicCalendar \
  -d '{"weekStartDate":"2026-06-08"}' \
  --json \
  -e <env-id>
```

若函数返回待审核 `slots` 而页面仍为空，再检查小程序是否连接同一环境、当前周是否正确，以及开发者工具是否加载了最新前端代码。
