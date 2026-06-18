# 仪器预约小程序实现前设计产物

> **文档状态：v1 历史设计，仅用于理解现有代码。** 其中手机号、学号、学院、导师、连续拖动预约、单段 `startAt/endAt`、公开身份、受限时段治理和用户维度统计等内容已经废弃。后续实现必须以 [`execution-baseline-v2.md`](./execution-baseline-v2.md) 为最高业务依据，以 [`style-guide.md`](./style-guide.md) 为视觉依据。

版本：v1.0  
技术栈：微信小程序 + 微信云开发  
业务对象：单台仪器预约  

参考：

- `frontend-design`：强调明确的设计方向、上下文匹配、排版/颜色/动效/空间组合，以及生产级可用性。
- `theme-factory`：强调把颜色、字体和视觉身份整理成可复用主题，并在整个产物中一致应用。

本项目采用自定义主题 `Instrument Console`，方向为“实验室仪器控制台”：清晰、克制、可信，适合预约、审核和统计等高频操作界面。视觉上避免营销式大图和装饰堆叠，优先让用户快速判断时段状态、审核状态和下一步动作。

## 1. 业务常量与枚举

### 1.1 时间规则

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `openStartHour` | `9` | 开放时间开始，09:00 |
| `openEndHour` | `18` | 开放时间结束，18:00 |
| `minBookingHours` | `1` | 最小预约单位 |
| `maxAdvanceDays` | `7` | 最多提前 7 天预约 |
| `cancelReviewBeforeHours` | `12` | 开始前 12 小时内取消需审核 |
| `waitlistConfirmHours` | `2` | 候补转正后 2 小时内确认 |
| `historyRetentionDays` | `365` | 历史记录保留 1 年 |

### 1.2 用户角色

| 值 | 名称 | 权限 |
| --- | --- | --- |
| `guest` | 游客 | 查看周历占用状态 |
| `user` | 普通用户 | 注册通过后可预约、取消、候补、查看个人面板 |
| `admin` | 管理员 | 审核、维护、受限时段、用户管理、统计 |

### 1.3 用户注册状态

| 值 | 名称 |
| --- | --- |
| `unsubmitted` | 未提交 |
| `pending` | 待审核 |
| `approved` | 已通过 |
| `rejected` | 已拒绝 |

### 1.4 预约状态

| 值 | 名称 | 是否占用时间 |
| --- | --- | --- |
| `pending_review` | 待审核 | 是 |
| `confirmed` | 已预约 | 是 |
| `completed` | 已完成 | 否，作为历史记录 |
| `cancel_pending` | 取消审核中 | 是 |
| `cancelled` | 已取消 | 否 |
| `rejected` | 审核拒绝 | 否 |
| `waitlisted` | 候补中 | 否 |
| `waitlist_confirming` | 候补确认中 | 临时占用，确认后转正式 |
| `waitlist_expired` | 候补确认超时 | 否 |

### 1.5 预约类型

| 值 | 名称 | 说明 |
| --- | --- | --- |
| `normal` | 普通预约 | 工作日 09:00-18:00，且不命中受限时段 |
| `special` | 特殊预约 | 夜间、周末、受限时段，需要管理员审核 |
| `maintenance_cancelled` | 维护取消 | 由维护时间冲突自动取消 |

## 2. 页面结构

### 2.1 小程序页面清单

建议替换示例工程页面后使用以下结构：

```text
miniprogram/
  pages/
    calendar/index
    auth/login
    auth/register
    booking/form
    profile/index
    profile/bookings
    profile/stats
    waitlist/index
    admin/index
    admin/user-review
    admin/booking-review
    admin/cancel-review
    admin/maintenance
    admin/restricted
    admin/users
    admin/stats
```

### 2.2 TabBar 建议

| Tab | 页面 | 游客 | 已登录用户 | 管理员 |
| --- | --- | --- | --- | --- |
| 周历 | `pages/calendar/index` | 可见 | 可见 | 可见 |
| 我的 | `pages/profile/index` | 跳登录 | 可见 | 可见 |
| 管理 | `pages/admin/index` | 不可见 | 不可见 | 可见 |

### 2.3 `pages/calendar/index` 周历主页

核心目标：让所有人看到仪器占用情况，让已审核用户完成预约选择。

页面状态：

| 状态 | 说明 |
| --- | --- |
| 未登录 | 仅显示占用、待审核占用、维护、可预约 |
| 已登录未注册 | 显示注册入口，不允许预约 |
| 注册待审核 | 显示审核状态，不允许预约 |
| 注册通过 | 可预约、可加入候补 |
| 管理员 | 可查看更完整预约信息 |

主要组件：

| 区域 | 内容 |
| --- | --- |
| 顶部周切换 | 本周、上一周、下一周；下一周不可超过 7 天提前预约范围 |
| 时间范围切换 | 默认工作时间；可展开夜间时段 |
| 周历网格 | 7 天列，整点小时行 |
| 图例 | 可预约、已预约、待审核、维护、受限、候补 |
| 预约弹层 | 长按/滑动选中后打开 |

交互：

| 行为 | 结果 |
| --- | --- |
| 长按小时格 | 进入选择模式 |
| 滑动经过小时格 | 扩展选中时间 |
| 松手 | 打开预约表单 |
| 点击单格 | 选择 1 小时时段 |
| 点击已占用时段 | 注册通过用户可加入候补；游客只看占用 |
| 点击待审核/维护 | 查看不可预约提示 |

调用接口：

| 场景 | 云函数 |
| --- | --- |
| 初始化身份 | `login` |
| 获取周历数据 | `getCalendarBookings` |
| 创建预约 | `createBooking` |
| 加入候补 | `joinWaitlist` |

### 2.4 `pages/auth/login` 登录页

功能：

- 调用微信登录获取 `openid`
- 拉取当前用户资料
- 根据注册状态跳转注册页、个人页或管理员页

调用接口：

- `login`

### 2.5 `pages/auth/register` 注册申请页

表单字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 姓名 |
| `phone` | 是 | 手机号 |
| `studentId` | 是 | 学号 |
| `college` | 是 | 学院 |
| `supervisor` | 是 | 导师/负责人 |

调用接口：

- `submitRegistration`

### 2.6 `pages/booking/form` 预约表单页/弹层

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `startAt` | 是 | 开始时间，整点 |
| `endAt` | 是 | 结束时间，整点，必须晚于开始时间 |
| `remark` | 否 | 备注 |

提交后可能结果：

| 结果 | 说明 |
| --- | --- |
| `confirmed` | 普通时段无冲突，预约成功 |
| `pending_review` | 特殊时段，待管理员审核，占用时间 |
| `conflict` | 有冲突，可加入候补 |
| `blocked_by_maintenance` | 命中维护时间，不可提交 |

调用接口：

- `createBooking`
- `joinWaitlist`

### 2.7 `pages/profile/index` 个人面板

展示：

| 模块 | 内容 |
| --- | --- |
| 个人状态 | 注册状态、角色 |
| 统计卡片 | 总预约时长、本周、本月 |
| 待开始预约 | 最近待开始预约 |
| 审核中 | 预约审核、取消审核 |
| 候补 | 候补中、确认中 |
| 快捷入口 | 我的预约、个人统计 |

调用接口：

- `getUserStats`
- `listMyBookings`
- `listMyWaitlists`

### 2.8 `pages/profile/bookings` 我的预约记录

筛选：

- 全部
- 待开始
- 历史
- 审核中
- 已取消

操作：

| 状态 | 操作 |
| --- | --- |
| `confirmed` | 取消 |
| `pending_review` | 取消申请 |
| `cancel_pending` | 查看审核状态 |
| `completed` | 查看详情 |

调用接口：

- `listMyBookings`
- `cancelBooking`

### 2.9 `pages/profile/stats` 个人统计

展示：

- 总预约时长
- 本周预约时长
- 本月预约时长
- 工作时间预约时长
- 非工作时间预约时长
- 最近 12 个月使用趋势

调用接口：

- `getUserStats`

### 2.10 `pages/waitlist/index` 我的候补

展示状态：

- 候补中
- 候补确认中
- 已过期

操作：

| 状态 | 操作 |
| --- | --- |
| `waitlist_confirming` | 确认转正 / 放弃 |
| `waitlisted` | 取消候补 |

调用接口：

- `listMyWaitlists`
- `confirmWaitlist`
- `cancelWaitlist`

### 2.11 `pages/admin/index` 管理首页

展示：

- 待审核注册数
- 待审核预约数
- 待审核取消数
- 今日/本月预约概览
- 管理功能入口

调用接口：

- `getAdminDashboard`

### 2.12 `pages/admin/user-review` 注册审核

功能：

- 查看待审核用户
- 通过
- 拒绝并填写拒绝原因

调用接口：

- `listRegistrationReviews`
- `reviewRegistration`

### 2.13 `pages/admin/booking-review` 预约审核

功能：

- 查看特殊时段预约
- 查看命中特殊规则原因
- 通过 / 拒绝
- 拒绝时填写原因

调用接口：

- `listBookingReviews`
- `reviewBooking`

### 2.14 `pages/admin/cancel-review` 取消审核

功能：

- 查看 12 小时内取消申请
- 通过后释放时段并触发候补
- 拒绝后恢复预约状态

调用接口：

- `listCancelReviews`
- `reviewCancel`

### 2.15 `pages/admin/maintenance` 维护时间设置

功能：

- 新增维护时间
- 查看维护列表
- 删除未开始维护时间
- 新增维护时间若冲突已有预约，自动取消冲突预约并通知用户

调用接口：

- `listMaintenanceSlots`
- `createMaintenance`
- `deleteMaintenance`

### 2.16 `pages/admin/restricted` 受限时段设置

功能：

- 新增单次受限时段
- 查看受限时段列表
- 删除未开始受限时段

调用接口：

- `listRestrictedSlots`
- `createRestrictedSlot`
- `deleteRestrictedSlot`

### 2.17 `pages/admin/users` 用户管理

第一版功能：

- 查看用户列表
- 查看用户详情
- 查看用户预约记录

第一版不做：

- 禁用用户
- 修改用户资料
- 管理员代约

调用接口：

- `listUsers`
- `getUserDetail`

### 2.18 `pages/admin/stats` 使用统计

统计维度：

- 按用户统计预约时长
- 按月份统计总使用时长
- 按工作时间/非工作时间统计

筛选：

- 时间范围
- 用户

调用接口：

- `getAdminStats`

## 3. 云数据库设计

### 3.1 设计原则

- 所有写操作优先走云函数，便于做权限、冲突检测和审计。
- 小程序端只允许读取必要的公开数据。
- 预约时间统一存储为 `Date` 类型。
- 时区按 `Asia/Shanghai` 处理，前端展示时统一格式化。
- 所有集合保留 `createdAt`、`updatedAt`。

### 3.2 `users` 用户集合

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 是 | 云数据库 ID |
| `openid` | string | 是 | 微信 openid，唯一 |
| `role` | string | 是 | `user` / `admin` |
| `registrationStatus` | string | 是 | `unsubmitted` / `pending` / `approved` / `rejected` |
| `name` | string | 否 | 姓名 |
| `phone` | string | 否 | 手机号 |
| `studentId` | string | 否 | 学号 |
| `college` | string | 否 | 学院 |
| `supervisor` | string | 否 | 导师/负责人 |
| `rejectReason` | string | 否 | 注册拒绝原因 |
| `reviewedBy` | string | 否 | 审核管理员 userId |
| `reviewedAt` | Date | 否 | 审核时间 |
| `lastLoginAt` | Date | 否 | 最近登录时间 |
| `createdAt` | Date | 是 | 创建时间 |
| `updatedAt` | Date | 是 | 更新时间 |

索引：

| 索引 | 类型 |
| --- | --- |
| `openid` | 唯一 |
| `role` | 普通 |
| `registrationStatus` | 普通 |

权限：

- 用户只能读自己的完整资料。
- 管理员可读所有用户。
- 角色设置由数据库手动维护或云函数内部维护，不由前端直接写。

### 3.3 `bookings` 预约集合

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 是 | 预约 ID |
| `userId` | string | 是 | 用户集合 ID |
| `openid` | string | 是 | 用户 openid |
| `userName` | string | 是 | 冗余姓名，便于周历展示 |
| `college` | string | 是 | 冗余学院，便于周历展示 |
| `startAt` | Date | 是 | 用户选择的开始时间 |
| `endAt` | Date | 是 | 用户选择的结束时间 |
| `occupiedSegments` | Array | 是 | 实际占用片段，跨天时拆分 |
| `durationHours` | number | 是 | 实际占用小时数 |
| `remark` | string | 否 | 备注 |
| `status` | string | 是 | 预约状态 |
| `bookingType` | string | 是 | `normal` / `special` |
| `specialReasons` | Array | 否 | 系统判定的需审核规则：`night` / `weekend` / `restricted`，不是用户填写的预约原因 |
| `cancelReason` | string | 否 | 取消原因 |
| `cancelRequestedAt` | Date | 否 | 取消申请时间 |
| `cancelReviewReason` | string | 否 | 取消审核原因 |
| `reviewedBy` | string | 否 | 特殊预约审核管理员 |
| `reviewedAt` | Date | 否 | 特殊预约审核时间 |
| `reviewReason` | string | 否 | 审核拒绝/说明 |
| `completedAt` | Date | 否 | 标记完成时间 |
| `createdAt` | Date | 是 | 创建时间 |
| `updatedAt` | Date | 是 | 更新时间 |

`occupiedSegments` 示例：

```json
[
  {
    "startAt": "2026-06-10T07:00:00.000Z",
    "endAt": "2026-06-10T10:00:00.000Z",
    "isWorkingHours": true
  },
  {
    "startAt": "2026-06-11T01:00:00.000Z",
    "endAt": "2026-06-11T04:00:00.000Z",
    "isWorkingHours": true
  }
]
```

说明：示例中 UTC 时间对应北京时间 2026-06-10 15:00-18:00 和 2026-06-11 09:00-12:00。

索引：

| 索引 | 类型 |
| --- | --- |
| `userId,status,startAt` | 复合 |
| `status,startAt,endAt` | 复合 |
| `startAt,endAt` | 复合 |
| `createdAt` | 普通 |

冲突检测状态：

- `pending_review`
- `confirmed`
- `cancel_pending`
- `waitlist_confirming`

这些状态视为占用或临时占用。

### 3.4 `waitlists` 候补集合

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 是 | 候补 ID |
| `bookingId` | string | 否 | 关联原冲突预约，可能为空 |
| `userId` | string | 是 | 候补用户 |
| `openid` | string | 是 | 候补用户 openid |
| `startAt` | Date | 是 | 期望开始时间 |
| `endAt` | Date | 是 | 期望结束时间 |
| `occupiedSegments` | Array | 是 | 期望占用片段 |
| `remark` | string | 否 | 备注 |
| `status` | string | 是 | `waitlisted` / `confirming` / `confirmed` / `cancelled` / `expired` |
| `queueOrder` | number | 是 | 队列顺序 |
| `confirmDeadlineAt` | Date | 否 | 确认截止时间 |
| `convertedBookingId` | string | 否 | 转正后的预约 ID |
| `createdAt` | Date | 是 | 创建时间 |
| `updatedAt` | Date | 是 | 更新时间 |

索引：

| 索引 | 类型 |
| --- | --- |
| `startAt,endAt,status,queueOrder` | 复合 |
| `userId,status` | 复合 |
| `bookingId,status` | 复合 |

### 3.5 `maintenance_slots` 维护时间集合

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 是 | 维护 ID |
| `startAt` | Date | 是 | 维护开始 |
| `endAt` | Date | 是 | 维护结束 |
| `reason` | string | 否 | 维护原因 |
| `createdBy` | string | 是 | 管理员 userId |
| `cancelledBookingIds` | Array | 否 | 因维护自动取消的预约 |
| `status` | string | 是 | `active` / `deleted` |
| `createdAt` | Date | 是 | 创建时间 |
| `updatedAt` | Date | 是 | 更新时间 |

索引：

| 索引 | 类型 |
| --- | --- |
| `status,startAt,endAt` | 复合 |

### 3.6 `restricted_slots` 受限时段集合

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 是 | 受限时段 ID |
| `startAt` | Date | 是 | 开始时间 |
| `endAt` | Date | 是 | 结束时间 |
| `reason` | string | 否 | 受限原因 |
| `createdBy` | string | 是 | 管理员 userId |
| `status` | string | 是 | `active` / `deleted` |
| `createdAt` | Date | 是 | 创建时间 |
| `updatedAt` | Date | 是 | 更新时间 |

索引：

| 索引 | 类型 |
| --- | --- |
| `status,startAt,endAt` | 复合 |

### 3.7 `review_logs` 审核记录集合

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 是 | 审核记录 ID |
| `targetType` | string | 是 | `registration` / `booking` / `cancel` |
| `targetId` | string | 是 | 被审核对象 ID |
| `action` | string | 是 | `approve` / `reject` |
| `reason` | string | 否 | 审核说明 |
| `reviewerId` | string | 是 | 管理员 userId |
| `createdAt` | Date | 是 | 创建时间 |

索引：

| 索引 | 类型 |
| --- | --- |
| `targetType,targetId` | 复合 |
| `reviewerId,createdAt` | 复合 |

### 3.8 `notifications` 通知记录集合

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 是 | 通知 ID |
| `userId` | string | 是 | 接收用户 |
| `openid` | string | 是 | 接收 openid |
| `type` | string | 是 | 通知类型 |
| `title` | string | 是 | 标题 |
| `content` | string | 是 | 内容 |
| `relatedType` | string | 否 | 关联类型 |
| `relatedId` | string | 否 | 关联 ID |
| `sendStatus` | string | 是 | `pending` / `sent` / `failed` |
| `errorMessage` | string | 否 | 失败原因 |
| `createdAt` | Date | 是 | 创建时间 |
| `sentAt` | Date | 否 | 发送时间 |

通知类型：

- `registration_result`
- `booking_review_result`
- `cancel_review_result`
- `waitlist_confirming`
- `maintenance_cancelled`

### 3.9 `settings` 系统配置集合

建议只有一条记录，`_id = "global"`。

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 是 | `global` |
| `openStartHour` | number | 是 | 默认 9 |
| `openEndHour` | number | 是 | 默认 18 |
| `minBookingHours` | number | 是 | 默认 1 |
| `maxAdvanceDays` | number | 是 | 默认 7 |
| `cancelReviewBeforeHours` | number | 是 | 默认 12 |
| `waitlistConfirmHours` | number | 是 | 默认 2 |
| `historyRetentionDays` | number | 是 | 默认 365 |
| `updatedAt` | Date | 是 | 更新时间 |

## 4. 云函数接口规格

### 4.1 通用约定

请求：

```js
wx.cloud.callFunction({
  name: 'functionName',
  data: {}
})
```

返回：

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

错误返回：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "无权限操作"
  }
}
```

通用错误码：

| 错误码 | 说明 |
| --- | --- |
| `PERMISSION_DENIED` | 无权限 |
| `NOT_LOGGED_IN` | 未登录 |
| `REGISTRATION_REQUIRED` | 未注册或未审核通过 |
| `INVALID_PARAMS` | 参数错误 |
| `TIME_CONFLICT` | 时间冲突 |
| `MAINTENANCE_BLOCKED` | 命中维护时间 |
| `NOT_FOUND` | 数据不存在 |
| `STATE_CHANGED` | 状态已变化 |

### 4.2 `login`

用途：获取 openid，并返回用户状态。

入参：

```json
{}
```

出参：

```json
{
  "openid": "openid",
  "user": {
    "_id": "userId",
    "role": "user",
    "registrationStatus": "approved",
    "name": "张三",
    "college": "材料学院"
  }
}
```

逻辑：

1. 通过 `cloud.getWXContext()` 获取 `OPENID`。
2. 查询 `users.openid`。
3. 不存在则创建用户，`role = user`，`registrationStatus = unsubmitted`。
4. 更新 `lastLoginAt`。

### 4.3 `submitRegistration`

用途：提交或重新提交注册申请。

入参：

```json
{
  "name": "张三",
  "phone": "13800000000",
  "studentId": "20260001",
  "college": "材料学院",
  "supervisor": "李老师"
}
```

出参：

```json
{
  "registrationStatus": "pending"
}
```

校验：

- 手机号、姓名、学号、学院、导师必填。
- 已通过用户不能重复提交。

### 4.4 `reviewRegistration`

用途：管理员审核注册申请。

入参：

```json
{
  "userId": "userId",
  "action": "approve",
  "reason": ""
}
```

出参：

```json
{
  "userId": "userId",
  "registrationStatus": "approved"
}
```

校验：

- 仅管理员可调用。
- `action` 为 `approve` 或 `reject`。
- 拒绝时 `reason` 必填。

副作用：

- 写入 `review_logs`。
- 写入并发送 `registration_result` 通知。

### 4.5 `getCalendarBookings`

用途：获取周历数据。

入参：

```json
{
  "weekStartDate": "2026-06-08",
  "includeNight": false
}
```

出参：

```json
{
  "weekStartDate": "2026-06-08",
  "days": ["2026-06-08", "2026-06-09"],
  "hours": [9, 10, 11, 12, 13, 14, 15, 16, 17],
  "items": [
    {
      "type": "booking",
      "bookingId": "bookingId",
      "status": "confirmed",
      "startAt": "2026-06-09T01:00:00.000Z",
      "endAt": "2026-06-09T03:00:00.000Z",
      "displayName": "张三",
      "college": "材料学院"
    }
  ],
  "maintenanceSlots": [],
  "restrictedSlots": []
}
```

显示权限：

- 游客：`displayName`、`college` 返回空，只返回状态。
- 已登录用户：返回预约人姓名和学院。
- 管理员：可返回备注和审核信息。

### 4.6 `createBooking`

用途：创建预约。

入参：

```json
{
  "startAt": "2026-06-09T01:00:00.000Z",
  "endAt": "2026-06-09T03:00:00.000Z",
  "remark": "测试样品"
}
```

出参：

```json
{
  "bookingId": "bookingId",
  "status": "confirmed",
  "bookingType": "normal",
  "specialReasons": []
}
```

校验：

1. 用户必须注册审核通过。
2. 开始/结束时间必须为整点。
3. 至少 1 小时。
4. 不能超过未来 7 天预约窗口。
5. 不能命中维护时间。
6. 与占用状态预约冲突时返回 `TIME_CONFLICT`，并提示可加入候补。

判断特殊预约：

- 周末：`weekend`
- 18:00-09:00：`night`
- 命中受限时段：`restricted`

状态：

- 普通预约：`confirmed`
- 特殊预约：`pending_review`

### 4.7 `reviewBooking`

用途：管理员审核特殊预约。

入参：

```json
{
  "bookingId": "bookingId",
  "action": "approve",
  "reason": ""
}
```

出参：

```json
{
  "bookingId": "bookingId",
  "status": "confirmed"
}
```

校验：

- 仅管理员可调用。
- 预约状态必须为 `pending_review`。
- 拒绝时释放时段，状态变为 `rejected`。

副作用：

- 写入 `review_logs`。
- 写入并发送 `booking_review_result` 通知。

### 4.8 `cancelBooking`

用途：用户取消预约或提交取消审核。

入参：

```json
{
  "bookingId": "bookingId",
  "reason": "实验计划调整"
}
```

出参：

```json
{
  "bookingId": "bookingId",
  "status": "cancelled",
  "needReview": false
}
```

规则：

- 开始前 12 小时外：直接 `cancelled`，释放时段，触发候补。
- 开始前 12 小时内：改为 `cancel_pending`，仍占用，等待管理员审核。

校验：

- 只能取消自己的预约。
- 仅 `confirmed` 或 `pending_review` 可取消。

### 4.9 `reviewCancel`

用途：管理员审核取消申请。

入参：

```json
{
  "bookingId": "bookingId",
  "action": "approve",
  "reason": ""
}
```

出参：

```json
{
  "bookingId": "bookingId",
  "status": "cancelled"
}
```

规则：

- 通过：预约变为 `cancelled`，释放时段，触发候补。
- 拒绝：预约恢复为 `confirmed`。

副作用：

- 写入 `review_logs`。
- 写入并发送 `cancel_review_result` 通知。

### 4.10 `joinWaitlist`

用途：加入候补。

入参：

```json
{
  "startAt": "2026-06-09T01:00:00.000Z",
  "endAt": "2026-06-09T03:00:00.000Z",
  "remark": "希望候补该时段"
}
```

出参：

```json
{
  "waitlistId": "waitlistId",
  "queueOrder": 1,
  "status": "waitlisted"
}
```

校验：

- 用户必须注册审核通过。
- 不能候补维护时段。
- 同一用户同一时间段不能重复候补。

### 4.11 `confirmWaitlist`

用途：候补转正后，用户确认或放弃。

入参：

```json
{
  "waitlistId": "waitlistId",
  "action": "confirm"
}
```

出参：

```json
{
  "waitlistId": "waitlistId",
  "status": "confirmed",
  "bookingId": "newBookingId"
}
```

规则：

- `action = confirm`：创建正式预约，候补状态变为 `confirmed`。
- `action = decline`：候补状态变为 `cancelled`，触发下一位候补确认。
- 超过 `confirmDeadlineAt` 不能确认。

### 4.12 `cancelWaitlist`

用途：用户取消候补。

入参：

```json
{
  "waitlistId": "waitlistId"
}
```

出参：

```json
{
  "waitlistId": "waitlistId",
  "status": "cancelled"
}
```

### 4.13 `createMaintenance`

用途：管理员创建维护时间。

入参：

```json
{
  "startAt": "2026-06-12T01:00:00.000Z",
  "endAt": "2026-06-12T04:00:00.000Z",
  "reason": "仪器校准"
}
```

出参：

```json
{
  "maintenanceId": "maintenanceId",
  "cancelledBookingIds": ["bookingId1"]
}
```

规则：

1. 维护时间绝对禁止预约。
2. 若与已有占用预约冲突，自动取消冲突预约。
3. 冲突预约取消原因为 `maintenance_cancelled`。
4. 必须通知被取消用户。
5. 维护创建后触发候补重新评估，但候补若仍命中维护，不转正。

### 4.14 `deleteMaintenance`

用途：删除未开始维护时间。

入参：

```json
{
  "maintenanceId": "maintenanceId"
}
```

出参：

```json
{
  "maintenanceId": "maintenanceId",
  "status": "deleted"
}
```

校验：

- 仅管理员可调用。
- 已开始维护不允许删除，只能结束后保留历史。

### 4.15 `createRestrictedSlot`

用途：管理员创建单次受限时段。

入参：

```json
{
  "startAt": "2026-06-13T10:00:00.000Z",
  "endAt": "2026-06-13T12:00:00.000Z",
  "reason": "培训时段，需审核"
}
```

出参：

```json
{
  "restrictedSlotId": "restrictedSlotId"
}
```

规则：

- 受限时段不禁止预约。
- 命中该时段的预约进入 `pending_review`。

### 4.16 `deleteRestrictedSlot`

用途：删除未开始受限时段。

入参：

```json
{
  "restrictedSlotId": "restrictedSlotId"
}
```

出参：

```json
{
  "restrictedSlotId": "restrictedSlotId",
  "status": "deleted"
}
```

### 4.17 列表类接口

为减少云函数数量，也可以合并为 `adminQuery` / `userQuery`，但第一版建议先清晰拆分。

| 云函数 | 用途 | 主要入参 |
| --- | --- | --- |
| `listMyBookings` | 我的预约列表 | `status`, `page`, `pageSize` |
| `listMyWaitlists` | 我的候补列表 | `status`, `page`, `pageSize` |
| `listRegistrationReviews` | 待审核注册 | `page`, `pageSize` |
| `listBookingReviews` | 待审核预约 | `page`, `pageSize` |
| `listCancelReviews` | 待审核取消 | `page`, `pageSize` |
| `listMaintenanceSlots` | 维护时间列表 | `startAt`, `endAt`, `status` |
| `listRestrictedSlots` | 受限时段列表 | `startAt`, `endAt`, `status` |
| `listUsers` | 用户列表 | `keyword`, `registrationStatus`, `page`, `pageSize` |
| `getUserDetail` | 用户详情 | `userId` |

### 4.18 `getUserStats`

用途：个人统计。

入参：

```json
{
  "from": "2026-01-01",
  "to": "2026-12-31"
}
```

出参：

```json
{
  "totalHours": 120,
  "weekHours": 6,
  "monthHours": 18,
  "workingHours": 100,
  "nonWorkingHours": 20,
  "upcomingCount": 2,
  "pendingCount": 1,
  "cancelledCount": 3,
  "monthlyTrend": [
    {
      "month": "2026-06",
      "hours": 18
    }
  ]
}
```

统计口径：

- 仅统计 `confirmed`、`completed`。
- `cancelled`、`rejected` 不计入使用时长。
- `pending_review` 可单独展示，不计入已使用。

### 4.19 `getAdminStats`

用途：管理员统计。

入参：

```json
{
  "from": "2026-01-01",
  "to": "2026-12-31",
  "userId": ""
}
```

出参：

```json
{
  "totalHours": 560,
  "workingHours": 430,
  "nonWorkingHours": 130,
  "byUser": [
    {
      "userId": "userId",
      "name": "张三",
      "college": "材料学院",
      "hours": 42
    }
  ],
  "byMonth": [
    {
      "month": "2026-06",
      "hours": 88
    }
  ],
  "byTimeType": {
    "workingHours": 430,
    "nonWorkingHours": 130
  }
}
```

### 4.20 `sendNotification`

用途：统一发送核心通知。

入参：

```json
{
  "userId": "userId",
  "type": "registration_result",
  "relatedType": "user",
  "relatedId": "userId",
  "payload": {}
}
```

说明：

- 第一版可以先写入 `notifications` 记录。
- 接入订阅消息后再补充模板 ID 和发送逻辑。
- 发送失败不应阻断主业务，但要记录失败原因。

## 5. 核心业务算法

### 5.1 跨天预约占用片段拆分

输入：用户选择的 `startAt`、`endAt`。  
输出：`occupiedSegments`。

规则：

1. 遍历开始日期到结束日期之间的每一天。
2. 每天只取 09:00-18:00 的交集。
3. 如果当天是周末，仍可生成片段，但标记为特殊原因 `weekend`。
4. 如果选择完全没有开放时间交集，且用户选择的是夜间，则按夜间片段处理并进入特殊审核。

### 5.2 工作时间/非工作时间判定

- 工作日且 09:00-18:00：工作时间。
- 18:00-09:00：非工作时间，需要审核。
- 周末：需要审核。
- 命中受限时段：需要审核。
- 命中维护时间：不可预约。

### 5.3 冲突检测

检测对象状态：

- `pending_review`
- `confirmed`
- `cancel_pending`
- `waitlist_confirming`

冲突条件：

```text
newSegment.startAt < existingSegment.endAt
AND
newSegment.endAt > existingSegment.startAt
```

维护时间冲突同理。

### 5.4 候补转正流程

触发时机：

- 预约取消成功。
- 取消审核通过。
- 候补确认超时。
- 候补用户主动放弃。

流程：

1. 查找同一时间段仍有效的候补。
2. 按 `queueOrder` 和 `createdAt` 排序。
3. 找第一位不命中维护、不与当前占用冲突的候补。
4. 状态改为 `confirming`。
5. 设置 `confirmDeadlineAt = now + 2 hours`。
6. 写入并发送 `waitlist_confirming` 通知。

## 6. 云数据库权限建议

| 集合 | 小程序端读 | 小程序端写 | 云函数 |
| --- | --- | --- | --- |
| `users` | 仅本人基础信息 | 禁止 | 全部写操作 |
| `bookings` | 周历公开字段/本人完整字段 | 禁止 | 全部写操作 |
| `waitlists` | 仅本人 | 禁止 | 全部写操作 |
| `maintenance_slots` | 公开读 active | 禁止 | 管理员写 |
| `restricted_slots` | 公开读 active | 禁止 | 管理员写 |
| `review_logs` | 禁止 | 禁止 | 管理员读写 |
| `notifications` | 仅本人 | 禁止 | 云函数写 |
| `settings` | 公开读 | 禁止 | 管理员写 |

## 7. 前端设计与主题实施细节

### 7.1 设计目标

本小程序不是展示型网站，而是一个需要频繁查看、判断和操作的预约工具。第一版前端目标如下：

| 目标 | 实施要求 |
| --- | --- |
| 快速判断 | 用户打开主页 3 秒内能判断本周哪些时段可预约 |
| 状态明确 | 已预约、待审核、维护、受限、候补必须有稳定且可区分的视觉状态 |
| 操作低负担 | 长按/滑动选择时间后直接填写备注并提交 |
| 管理高效率 | 管理端以待办优先，减少管理员查找成本 |
| 触控可靠 | 所有可点区域适配手机触控，不依赖精细鼠标操作 |
| 风格一致 | 颜色、间距、圆角、字体、按钮、标签全部由主题令牌驱动 |

### 7.2 主题方向：`Instrument Console`

设计关键词：

- `precise`：精确，强调时间格、状态边界和数字统计。
- `calm`：冷静，减少干扰色，只在关键状态上使用强调色。
- `clinical`：实验室感，背景清洁、留白克制。
- `operational`：工具属性，首页直接进入周历，不做宣传页。

不采用：

- 大面积渐变背景。
- 营销式 Hero。
- 重装饰卡片堆叠。
- 过度圆角。
- 单一蓝紫色系铺满整个界面。

### 7.3 颜色令牌

建议在 `miniprogram/styles/tokens.wxss` 定义 CSS 变量。微信小程序基础库已支持大部分 CSS 变量场景，若某些组件兼容性不足，再在页面 WXSS 内回退为静态值。

```css
page {
  --color-bg: #f7f8fa;
  --color-surface: #ffffff;
  --color-surface-muted: #f0f3f6;
  --color-border: #d8dee6;
  --color-border-strong: #b7c1cc;

  --color-text: #18212b;
  --color-text-secondary: #526170;
  --color-text-muted: #7c8a99;
  --color-text-inverse: #ffffff;

  --color-primary: #0f766e;
  --color-primary-pressed: #0b5f59;
  --color-primary-soft: #d9f3ef;

  --color-accent: #2563eb;
  --color-accent-soft: #dbeafe;

  --color-success: #15803d;
  --color-success-soft: #dcfce7;
  --color-warning: #b7791f;
  --color-warning-soft: #fef3c7;
  --color-danger: #b42318;
  --color-danger-soft: #fee4e2;
  --color-maintenance: #475569;
  --color-maintenance-soft: #e2e8f0;
  --color-restricted: #7c3aed;
  --color-restricted-soft: #ede9fe;

  --shadow-popover: 0 12rpx 36rpx rgba(24, 33, 43, 0.14);
}
```

颜色使用规则：

| 场景 | 背景 | 文字/边框 | 说明 |
| --- | --- | --- | --- |
| 可预约 | `--color-surface` | `--color-border` | 保持低噪声 |
| 已预约 | `--color-primary-soft` | `--color-primary` | 普通成功占用 |
| 待审核占用 | `--color-warning-soft` | `--color-warning` | 占用但未最终通过 |
| 取消审核中 | `--color-warning-soft` | `--color-warning` | 与待审核一致，但文案区分 |
| 维护 | `--color-maintenance-soft` | `--color-maintenance` | 绝对不可预约 |
| 受限 | `--color-restricted-soft` | `--color-restricted` | 可申请但需审核 |
| 候补确认中 | `--color-accent-soft` | `--color-accent` | 需要用户动作 |
| 拒绝/错误 | `--color-danger-soft` | `--color-danger` | 审核拒绝、冲突失败 |

### 7.4 字体与排版

小程序优先使用系统字体，减少字体加载失败和首屏闪动。

```css
page {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
  color: var(--color-text);
  font-size: 28rpx;
  line-height: 1.45;
}
```

排版令牌：

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--font-size-xs` | `22rpx` | 标签、辅助说明 |
| `--font-size-sm` | `24rpx` | 次要信息 |
| `--font-size-md` | `28rpx` | 正文 |
| `--font-size-lg` | `32rpx` | 页面小标题 |
| `--font-size-xl` | `40rpx` | 页面主标题 |
| `--line-tight` | `1.25` | 时间、数字 |
| `--line-normal` | `1.45` | 正文 |

页面字号规则：

- 周历格内文字不超过两行，超出隐藏或改用状态点。
- 统计数字使用 `40rpx`，单位和说明使用 `24rpx`。
- 管理列表标题使用 `30rpx`，状态标签使用 `22rpx`。
- 不使用随屏幕宽度变化的字体大小。

### 7.5 间距、圆角与布局令牌

```css
page {
  --space-1: 4rpx;
  --space-2: 8rpx;
  --space-3: 12rpx;
  --space-4: 16rpx;
  --space-5: 24rpx;
  --space-6: 32rpx;
  --space-7: 48rpx;

  --radius-sm: 6rpx;
  --radius-md: 8rpx;
  --radius-lg: 12rpx;
}
```

布局规则：

- 页面外边距使用 `24rpx`。
- 周历网格占满主视觉区域，不包在装饰性大卡片中。
- 卡片只用于记录项、审核项、统计项和弹层内容。
- 卡片圆角默认 `8rpx`，弹层可用 `12rpx`。
- 按钮高度不小于 `80rpx`。
- 图标按钮触控热区不小于 `72rpx * 72rpx`。

### 7.6 全局样式文件规划

建议新增：

```text
miniprogram/styles/
  tokens.wxss
  base.wxss
  components.wxss
  calendar.wxss
```

职责：

| 文件 | 职责 |
| --- | --- |
| `tokens.wxss` | 颜色、字体、间距、圆角、阴影令牌 |
| `base.wxss` | 页面背景、通用文本、滚动容器、安全区 |
| `components.wxss` | 按钮、状态标签、空态、列表项、表单 |
| `calendar.wxss` | 周历网格、选中态、拖拽态、时间轴 |

在 `app.wxss` 中按顺序引入：

```css
@import "./styles/tokens.wxss";
@import "./styles/base.wxss";
@import "./styles/components.wxss";
```

周历页面单独引入：

```css
@import "../../styles/calendar.wxss";
```

### 7.7 周历视觉规格

网格结构：

| 元素 | 规格 |
| --- | --- |
| 日期表头 | 固定顶部，显示周几 + 日期 |
| 时间列 | 左侧固定宽度 `88rpx` |
| 天列 | 7 等分，最小宽度不足时横向滚动 |
| 小时格高度 | `96rpx` |
| 工作时间默认行 | 09:00-18:00 共 9 行 |
| 夜间展开 | 00:00-24:00 共 24 行 |

移动端适配：

- 屏幕宽度不足时，时间列固定，日期列横向滚动。
- 当前日期列使用浅色边线强调，不使用大面积背景。
- 当前时间线使用 `--color-danger` 细线，仅当天显示。
- 周末日期表头添加 `周末` 小标签。

状态格样式：

| 状态 | 表现 |
| --- | --- |
| 可预约 | 白底、细边框、点击/长按有反馈 |
| 已预约 | 绿色浅底，左侧 4rpx 状态条 |
| 待审核 | 黄色浅底，虚线边框 |
| 维护 | 灰底，斜线纹理或维护图标 |
| 受限 | 紫色浅底，角标 `审` |
| 选中中 | 蓝色边框，半透明填充 |
| 冲突 | 红色边框抖动一次，并给出可候补入口 |

### 7.8 周历长按/滑动交互细节

事件流程：

1. `touchstart` 记录起始格，启动 350ms 长按计时。
2. 长按成立后进入 `selecting` 状态，并触发轻微震动。
3. `touchmove` 根据触点坐标计算当前格，扩展选区。
4. 选区跨天时按日期和小时生成候选片段。
5. `touchend` 打开预约弹层。
6. 若长按未成立，按点击单格处理。

交互约束：

- 选择时段必须整点对齐。
- 命中维护时间时，禁止提交，选区显示维护冲突。
- 命中已占用时段时，不直接预约，弹层显示加入候补。
- 命中特殊规则时，提交按钮文案为 `提交审核`。
- 普通预约按钮文案为 `确认预约`。

状态变量建议：

```js
data: {
  calendarMode: 'worktime',
  isSelecting: false,
  selectStartCell: null,
  selectEndCell: null,
  selectedSlots: [],
  activePopover: null
}
```

坐标计算建议：

- 页面渲染后通过 `wx.createSelectorQuery()` 缓存网格位置信息。
- 滚动或切换周后重新计算。
- 不在每次 `touchmove` 中查询 DOM，只使用缓存坐标换算。

### 7.9 预约弹层规格

弹层内容：

| 区域 | 内容 |
| --- | --- |
| 标题 | `预约仪器` / `提交特殊时段审核` / `加入候补` |
| 时间摘要 | 开始时间、结束时间、实际占用小时 |
| 规则提示 | 工作时间外、周末、受限、维护、冲突 |
| 备注输入 | 最多 200 字 |
| 主按钮 | 根据场景显示 |
| 次按钮 | 取消 |

文案规则：

- 不写功能说明式长段落。
- 只在状态变化处给一句明确提示。
- 错误提示必须给下一步，例如 `该时段已被预约，可加入候补`。

按钮规则：

| 场景 | 主按钮 |
| --- | --- |
| 普通预约 | `确认预约` |
| 特殊预约 | `提交审核` |
| 时间冲突 | `加入候补` |
| 维护冲突 | 禁用，显示 `维护中不可预约` |

### 7.10 表单组件规格

输入项：

| 组件 | 使用场景 | 规则 |
| --- | --- | --- |
| 单行输入 | 姓名、手机号、学号、学院、导师 | 高度 `88rpx` |
| 多行输入 | 备注、拒绝原因、维护原因 | 最少 4 行 |
| 时间选择 | 维护、受限时段 | 使用日期 + 整点小时选择 |
| 分段控件 | 记录筛选、统计维度 | 2-5 个选项 |
| 状态标签 | 审核状态、预约状态 | 使用统一状态色 |

校验：

- 手机号为空或格式不对时，输入框下方显示错误。
- 结束时间必须晚于开始时间。
- 开始时间和结束时间必须为整点。
- 备注、原因最多 200 字，超出禁用提交。

### 7.11 管理端界面实施细节

管理首页：

- 顶部展示待办数量：注册审核、预约审核、取消审核。
- 待办入口使用列表行，不使用大面积装饰卡片。
- 每个待办入口显示数量、最早待处理时间。

审核列表：

| 区域 | 内容 |
| --- | --- |
| 主信息 | 申请人、学院、时间范围 |
| 需审核规则 | 夜间/周末/受限/12 小时内取消，由系统自动判定 |
| 用户备注 | 用户预约时填写的备注；预约不要求填写原因 |
| 操作 | 通过、拒绝 |

审核操作：

- `通过` 使用主色按钮。
- `拒绝` 使用描边危险按钮。
- 拒绝必须弹出原因输入。
- 审核成功后列表项即时移除，顶部数量同步更新。

维护时间：

- 新增维护时先展示冲突预约数量。
- 提交前二次确认：`将自动取消 N 条预约并通知用户`。
- 维护列表按开始时间倒序，未开始维护可删除。

统计页：

- 顶部筛选时间范围。
- 第一屏显示总时长、工作时间、非工作时间。
- 用户排行使用表格化列表，显示用户、学院、时长。
- 月份趋势使用简洁柱状图；第一版可用 WXML + WXSS 实现，不必引入图表库。

### 7.12 状态标签规范

建议创建通用样式：

```css
.status-tag {
  display: inline-flex;
  align-items: center;
  height: 40rpx;
  padding: 0 12rpx;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  line-height: 1;
  border: 1rpx solid transparent;
}
```

状态映射：

| 状态 | 类名 | 文案 |
| --- | --- | --- |
| `pending_review` | `status-tag--warning` | 待审核 |
| `confirmed` | `status-tag--success` | 已预约 |
| `completed` | `status-tag--muted` | 已完成 |
| `cancel_pending` | `status-tag--warning` | 取消审核中 |
| `cancelled` | `status-tag--muted` | 已取消 |
| `rejected` | `status-tag--danger` | 已拒绝 |
| `waitlisted` | `status-tag--accent` | 候补中 |
| `waitlist_confirming` | `status-tag--accent` | 待确认 |

### 7.13 空态、加载态、错误态

空态：

- 周历无预约：不显示大插画，只保留清晰空格。
- 列表无数据：显示一行标题和一个可执行入口。

加载态：

- 周历加载使用骨架格，不用全屏转圈。
- 审核列表加载显示 3 条骨架行。
- 统计页加载保留卡片尺寸，避免布局跳动。

错误态：

| 场景 | 文案 |
| --- | --- |
| 登录失败 | `登录失败，请稍后重试` |
| 冲突 | `该时段已被预约，可加入候补` |
| 维护 | `该时段为维护时间，暂不可预约` |
| 无权限 | `当前账号暂无操作权限` |
| 审核状态变化 | `记录状态已更新，请刷新后重试` |

### 7.14 可访问性与触控标准

要求：

- 所有按钮触控区域不小于 `72rpx * 72rpx`。
- 状态不能只依赖颜色，至少同时使用文案、图标或边框样式。
- 文本和背景对比度保持清晰，浅色标签内文字使用深色。
- 表单错误信息紧贴字段下方。
- 弹层打开时主操作按钮固定在弹层底部。
- 夜间展开后保留回到工作时间的快捷按钮。

### 7.15 图标使用

微信小程序不能直接使用 `lucide-react`。建议：

- 使用 `image` 引入经过筛选的 SVG/PNG 图标资源。
- 或使用微信原生可用的 `icon` 组件处理基础状态。
- 图标只辅助识别，不作为唯一状态提示。

建议图标：

| 图标语义 | 用途 |
| --- | --- |
| `calendar` | 周历入口 |
| `user` | 我的 |
| `shield` | 管理 |
| `clock` | 时间/待审核 |
| `tool` | 维护 |
| `alert` | 受限/冲突 |
| `check` | 通过/确认 |
| `x` | 拒绝/取消 |

### 7.16 页面验收标准

周历主页：

- 未登录状态可以看到一周占用。
- 登录用户可以看到预约人姓名和学院。
- 选择格、拖动格、松手弹层三步稳定。
- 默认工作时间视图不需要横向/纵向过度滚动。
- 夜间展开后状态颜色仍可识别。

预约弹层：

- 普通预约、特殊预约、冲突候补、维护禁止四种场景文案不同。
- 提交后有明确成功/待审核/候补反馈。

管理端：

- 三类审核入口有待处理数量。
- 拒绝必须填写原因。
- 新增维护与已有预约冲突时有二次确认。

统计页：

- 用户统计、月份统计、工作/非工作时间统计都有空态。
- 数字、单位、筛选条件在小屏幕下不重叠。

### 7.17 实现时的前端文件任务

第一批新增文件：

```text
miniprogram/styles/tokens.wxss
miniprogram/styles/base.wxss
miniprogram/styles/components.wxss
miniprogram/styles/calendar.wxss
miniprogram/utils/date.js
miniprogram/utils/status.js
miniprogram/utils/theme.js
miniprogram/components/status-tag/
miniprogram/components/empty-state/
miniprogram/components/time-range-sheet/
miniprogram/components/calendar-grid/
```

工具函数职责：

| 文件 | 职责 |
| --- | --- |
| `date.js` | 周起止、整点判断、跨天拆分、工作时间判断 |
| `status.js` | 状态文案、状态颜色、是否占用 |
| `theme.js` | 主题令牌导出，便于 JS 中做状态映射 |

组件职责：

| 组件 | 职责 |
| --- | --- |
| `status-tag` | 统一状态标签 |
| `empty-state` | 统一空态 |
| `time-range-sheet` | 预约/候补/审核弹层 |
| `calendar-grid` | 周历网格、触控选择、状态渲染 |

## 8. 开发优先级建议

### 8.1 第一阶段：基础可运行

1. 清理示例工程页面，建立应用页面结构。
2. 初始化云开发环境。
3. 完成 `login`、`users`、注册申请。
4. 完成管理员手动标记与注册审核。
5. 建立全局主题令牌、基础组件和周历静态样式。
6. 完成周历读取与基础展示。

### 8.2 第二阶段：预约闭环

1. 实现长按/滑动选择时间。
2. 实现 `createBooking`。
3. 实现普通预约、特殊预约、冲突检测。
4. 实现个人预约列表与取消。
5. 实现预约审核、取消审核。
6. 完成预约弹层的四种状态：普通、特殊、冲突、维护。

### 8.3 第三阶段：高级规则

1. 候补队列与确认转正。
2. 维护时间与冲突自动取消。
3. 受限时段。
4. 核心通知记录与订阅消息接入。

### 8.4 第四阶段：统计与完善

1. 个人统计。
2. 管理员统计。
3. 权限与边界测试。
4. 真机触控体验优化。
5. 按前端验收标准检查小屏幕文本、按钮、弹层和周历网格。
