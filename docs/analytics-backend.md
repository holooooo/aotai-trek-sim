# 匿名统计与选后比例后端

本后端使用 Cloudflare Pages Functions 和 D1。数据库绑定名为 `DB`，迁移文件为 `migrations/0001_analytics.sql`。资源创建、Pages 绑定、迁移执行与部署由主任务负责；本模块没有自动执行这些操作。

服务端只接收稳定游戏 ID、数量、金额、时长和布尔状态。不读取或保存 IP、User-Agent、姓名、联系方式、地理坐标、对话正文或键盘输入。`visitorId` 是浏览器随机产生并本地保存的匿名设备标识；它不是账号或自然人。清除本地数据、换浏览器或换设备都会被视为另一个设备。Cloudflare 平台自身的访问日志/请求处理政策与本业务数据库分开管理。

## 文件与入口

- `functions/api/telemetry.js`：`POST /api/telemetry`。
- `functions/api/choices.js`：`GET/POST /api/choices`。
- `server/analytics.js`：请求校验、限流和参数化 D1 语句。
- `server/analytics-catalog.js`：允许的角色、难度、事件、物品、场景、选项 ID。
- `migrations/0001_analytics.sql`：表、触发器、索引和作者查询视图。
- `tests/analytics-server.test.js`：Node 真实 SQLite 与 handler 契约测试；需要支持 `node:sqlite` 的 Node 版本（当前使用 Node 24）。

## 通用请求约束

写请求必须带与请求 URL 完全相同的 `Origin`，并使用 `Content-Type: application/json`。`Sec-Fetch-Site: cross-site` 始终拒绝，不返回允许跨域写的 CORS 头。只读 GET 可以省略 Origin，但传入跨源 Origin 同样拒绝。

POST 请求体最多 32 KiB，包括无 `Content-Length` 的流式请求。字段按接口及事件类型严格白名单；未知字段和错误类型都会拒绝，整个批次不写入。ID 不允许正文或任意 Unicode。所有 SQL 值通过 `bind` 传入；问题 ID 和物品 ID 都不会拼接到 SQL 中。

错误状态：`400` 字段/类型/标识无效，`403` 非同源写，`405` 方法不允许，`413` 超大请求，`415` 非 JSON，`429` 基本限流，`503` 未绑定数据库或数据库不可用。响应仅含稳定的 `{error: "code"}`，不会把内部 SQL 或提交内容回显给客户端。所有 API 响应使用 `Cache-Control: no-store`。

客户端对缺失 consent 的访客默认开启遥测；明确保存的 `false` 表示用户退出，重新开启后才上传。关闭会持久保存 `aotai-analytics-consent-v1=false`，并清除本机匿名编号与待发送队列；网络或服务不可用时客户端应返回空状态、稍后重试，不阻塞游戏。选择比例可只读 GET；若要统计本人的选择，应在玩家做出选择后 POST，再显示该题的汇总。API 本身不承担防剧透权限控制，公开 GET 可被直接访问。

## 客户端本地状态

| Key | 值 | 作用 |
| --- | --- | --- |
| `aotai-analytics-consent-v1` | `true` / `false` | 当前是否开启；缺失时初始化为 `true` |
| `aotai-analytics-visitor-v1` | 随机 ID | 仅在开启时存在；关闭时删除 |
| `aotai-analytics-queue-v1` | JSON 事件数组 | 仅在开启时存在；关闭时删除 |

`false` 是持久退出标记，不能通过刷新或重新打开页面被默认开启逻辑覆盖。显式 `true` 保持开启；缺失 consent 时统一初始化为 `true`，不依据现存存档、游玩记录或其他偏好推断。

## POST /api/telemetry

请求格式：

```json
{
  "visitorId": "visitor_00000001",
  "events": [
    {
      "id": "receipt_00000001",
      "runId": "run_00000001",
      "type": "run_started",
      "at": 1792500000000,
      "role": "student",
      "difficulty": "normal",
      "fresh": true,
      "activeSeconds": 0
    }
  ]
}
```

成功响应为 `{ "accepted": 1, "duplicates": 0 }`。`accepted` 是新插入的事件数量；`duplicates` 是已有 event ID 的数量，包括同批重复。重试必须复用原 `id`，不能重新生成 ID。一个批次使用 D1 `batch` 原子提交；聚合触发器和事件行同成同败。不会因请求重发重复计数。

通用字段：

| 字段 | 约束 |
| --- | --- |
| visitorId | 请求根字段，8..96 位 `[A-Za-z0-9_-]`；建议随机 UUID，不使用账号或姓名 |
| events | 1..25 条，空批次拒绝 |
| id / runId | 每事件必需，8..96 位 `[A-Za-z0-9_-]`；事件 ID 应全局随机且稳定 |
| type | 仅允许下表列出的 8 种类型 |
| at | 必需，Unix 毫秒整数，0..4102444800000；仅作客户端时间记录，不用于授权 |
| role | 可选，student / veteran / blogger / runner / nurse / coder |
| difficulty | 可选，easy / normal / hardcore |
| activeSeconds | 可选，0..604800 的有限数字；该局累计的可操作活跃秒数，不是本批增量 |

事件专有字段：

| type | 可用专有字段 | 口径 |
| --- | --- | --- |
| run_started | fresh（可选，必须 true） | 每 visitor/run 仅首个开局计入开局次数，即使重试误用新事件 ID也不重复开局 |
| run_resumed | fresh（可选，必须 false） | 每个唯一事件计一次读档；一次真实读档对应一个稳定事件 ID |
| run_checkpoint | 无 | 只更新累计 activeSeconds 最大值 |
| shop_buy / shop_refund | 必需 itemId、quantity、cost | itemId 必须为现有物品；quantity 为 1..100 整数，cost 为 0..1000000 有限非负数，表示本次总额，退款也传正值 |
| event_started / event_completed | 必需 eventId | 现有裸事件 ID，或 event:id、npc:id、scene:id；来源需在白名单中 |
| run_ended | 必需 ending；可选 cause、death | ending 为主结局类型；dead 默认 cause=hypothermia，也可用已知死因；death 若传必须与 ending 是否 dead 一致 |

`run_ended` 的存活结局不得带非 null cause；死亡原因允许 hypothermia/fall/dehydration/starvation/injury/exhaustion。主结局包括 sausage/sigma/retreat_wild/turnback/retreat/retreat_branch/rescued/cross/dayehai/dead。每 visitor/run 只保留第一次结局，即使另一事件 ID 宣称不同结局，也不重复累计结局或解锁。运行时间取该局所有上报的累计最大值，乱序到达的小 checkpoint 不会倒退或重复增加总时长。服务器只验证格式和白名单，不证明玩家真的完成过该局。

事件/购物计数按唯一 telemetry event ID 计数。因此同一剧情的“看到”和“完成”要分别上报；同一次购买/退款的重试要复用同一 ID。由后端目录从物品 ID导出 category，客户端不得自报 category。

## GET/POST /api/choices

`questionId` 为 `<来源类型>:<来源ID>:<按 ASCII 排序且以 | 分隔的 optionIds>`，必须完全 canonical、长度不超过 160，只含 `[A-Za-z0-9_:|\-]`。`optionIds` 为 2..8 个不同的 ID（每个 1..32 位 `[A-Za-z0-9_-]`）。每个选项也必须属于对应来源的已知选项集合，不能利用一个合法来源任意造题。

来源类型允许 event、npc、scene。scene 允许 gate/dayehai/camp_snow/tent_collapse/cold_wake/ending_report/ending_family。单选确认、背包操作和休息时长菜单不属于投票题。同一 NPC 的多阶段对话以不同选项集合的 canonical 后缀隔离；只有一个确认选项的对话不统计。动态选项应使用界面这次呈现的完整选项 ID集合，包括置灰的选项；集合变更就是另一道题，不能混合分母。

POST 示例：

```json
{
  "visitorId": "visitor_00000001",
  "runId": "run_00000001",
  "questionId": "event:old_tent:check|leave",
  "optionId": "check",
  "optionIds": ["leave", "check"]
}
```

响应：

```json
{
  "questionId": "event:old_tent:check|leave",
  "total": 1,
  "counts": {"check": 1, "leave": 0},
  "recorded": true,
  "previousOptionId": "check"
}
```

每 run/question 只记录第一次选择（runId应全局随机，生成后随存档保持稳定）。相同请求重试或改选都会返回 `recorded: false`，`previousOptionId` 为已记录的原选择，counts 不变。更换visitorId但沿用同一runId也不能重投，且不会返回别的visitorId的原选择。POST 返回的汇总已含本票；如客户端选择 POST 后再 GET，同样不会重复投票。`previousOptionId` 只在 POST 自己提交的匿名标识对应查询里出现，GET 从不接受 visitorId/runId 或返回个人选择。

只读地址示例：

```text
/api/choices?questionId=event%3Aold_tent%3Acheck%7Cleave&optionIds=check%2Cleave
```

GET 成功只返回 `{questionId,total,counts}`。无样本时为 `total: 0`、各计数 0，不造百分比或示例数据；不会因读取而创建数据库行。比例由客户端按 `counts[id] / total` 计算，分母仅为这道 canonical 题的有效首票，并非全部玩家，也不是游戏胜率。GET 查询只读索引命中的 `choice_counts`，不扫描全部投票。

## 表、聚合和作者查询

`telemetry_events` 是事件去重收据兼最小原始数据；INSERT 后的触发器维护 `analytics_totals`、`analytics_runs`、`analytics_event_totals`、`analytics_shop_totals`、`analytics_endings` 和设备结局解锁集合。`choice_votes` 的复合主键约束首票，触发器维护 `choice_counts` 与 `choice_questions.total`。普通 API读取不聚合原始事件或投票全表。

只在 Cloudflare 账号/数据库管理界面或授权 CLI中执行以下作者查询。没有公开总体统计 HTTP路由，也没有公开 visitor/逐局记录 API。

```sql
SELECT * FROM analytics_overview;
SELECT * FROM analytics_event_totals ORDER BY started DESC;
SELECT * FROM analytics_shop_categories ORDER BY bought_quantity DESC;
SELECT * FROM analytics_shop_totals ORDER BY bought_quantity DESC;
SELECT * FROM analytics_endings ORDER BY total DESC;
SELECT * FROM analytics_role_difficulty;
```

口径：

| 字段 | 分母/含义 |
| --- | --- |
| players | 至少成功上报一次遥测的匿名设备数；只读比例/只投票不算遥测玩家 |
| run_started | 唯一 visitor/run 首次 run_started；准备商店阶段开始同一 run，不另开run ID |
| run_resumed | 唯一 run_resumed 事件数，可以大于开局次数 |
| ended_runs / deaths | 有首次有效 run_ended 的局数 / 其中 dead 局数 |
| active_seconds / active_runs | 累计 activeSeconds 最大值的跨局总和 / 至少报告过正活跃时长的局数 |
| avg_active_seconds_per_active_run | 上述总和除以 active_runs；包括未完局，不把没上报时长的局假定为0；0分母返回NULL |
| unique_ending_unlocks | 每匿名设备不同主结局键的个数总和；dead按cause区分，重复同结局不新增 |
| avg_unlocked_endings_per_device | unique_ending_unlocks / players；分母含尚未解锁任何结局的遥测设备；0分母返回NULL |

`analytics_role_difficulty` 是低频作者视图，按小于原始事件的逐局表聚合；公共写请求/比例读取不会执行此视图。统计只覆盖功能启用后产生且成功上报的活动，不代表发布前全部历史玩家；不得把本地历史记录自动补报成新开局。

## 基本防滥用与限制

接口有同源检查、流式体积限制、批次数量、有限目录、稳定事件去重、首票约束和每匿名标识每分钟最多120个写请求的有界 isolate 内存限流。若部署环境提供 Cloudflare rate-limit 绑定 `ANALYTICS_RATE_LIMIT`（含 `limit({key})`），使用其结果替代内存回退；该绑定不是必需，具体开通/额度由部署任务决定。

不读取 IP进行限流。内存限流最多保留2048个匿名键，isolate 重启或换区会重置。匿名 ID和 Origin均可被非浏览器伪造，因此这些是低成本的基本保护，不能称为防作弊、真人认证或防刷保证。需要更强保护时可在 Cloudflare边缘另配速率/WAF规则；本代码没有创建资源或开启付费服务。

## 保留、清理与D1免费额度

推荐先保留原始事件30..90天以查重复、乱序与事件漏报；再根据实际查询和额度评估。永久保留聚合表不会保留正文，因为正文从未接收。以下表还承担去重/首次状态，不能当作普通日志随意清空：

- `telemetry_events.id`：删除会允许旧重试重新插入、再次推动购物/事件/读档计数。
- `choice_votes` 的 run/question + visitor/option：删除会使同一局能够再次投票。
- `analytics_runs` 的 started/ended/active_seconds：删除会破坏同局去重和时长增量。
- `analytics_visitors`、`analytics_visitor_endings`：删除会破坏玩家去重与每设备解锁数。

要压缩原始数据，优先对超过保留期的 `telemetry_events` 清空可空的上下文字段（role/difficulty/event_id/item_id/item_category/quantity/cost/ending/cause/active_seconds/death/fresh），保留事件 ID收据；UPDATE不触发INSERT聚合，不会减少汇总。若确要完全删除收据，应同时实施客户端有界重试期限/统计版本隔离，再明确接受旧请求可能重算的边界。不要为省空间只删投票或逐局首状态而继续接收同一代 run ID。账号作者删除、重置或导出原始标识需在受权限保护的数据库工具处理，不提供公共删除他人数据接口。

免费额度关注 D1 实际 `rows_written`、索引维护、存储大小和请求数，不只看 HTTP数量。触发器会放大写入：真实 SQLite `total_changes` 测量的新设备首个开局约8行变更、已有局时长checkpoint约4行、首次死亡结局带解锁约10行；D1计费统计和索引写入可能更高，以部署后实际数据为准。一次投票约5行（题目、票、题目计数、选项计数等；重试更少）。批量遥测节省请求数，不减少每条事件的触发器变更。不要每帧上报；建议活跃时间最多每60秒checkpoint，页面隐藏/结局再补一次；离线重试必须保持稳定ID、批量发送并有上限。

## 验证

```bash
node --test tests/analytics-server.test.js
```

测试在内存真实 SQLite执行生产迁移与触发器，并通过 Request/Response 调用生产handler，覆盖事件/首票幂等、乱序累计时长、初次结局与设备解锁、购物数量/类别、0样本、不同选项集隔离、未知字段/ID、整批拒绝、跨站写、超大流式请求、缺少数据库与限流。部署方仍须在本地 Pages Functions/D1及生产绑定上验证实际路由打包、迁移、同源POST与失败降级。
