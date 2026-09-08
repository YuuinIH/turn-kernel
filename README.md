# turn-kernel

实验性的 TypeScript 回合制执行内核。游戏定义对象、规则和流程；内核提供隔离计算、受控操作、可恢复流程和存储提交协议。配套实验：[mindbug-lab](https://github.com/YuuinIH/mindbug-lab)。

## 运行

需要 Node.js 24+。

```sh
npm ci
npm run check
```

检查包括严格类型检查、编译期非法组合反例及行为测试。安装 `redis-server` 和 `redis-cli` 后自动执行真实 Redis 合约测试；`REQUIRE_REDIS=1 npm run check` 禁止跳过该测试，CI 使用此模式。Zod 是内核的正式运行时依赖，由内核统一导出；上层游戏无需单独安装。Redis 客户端由宿主注入。

## 模块边界

| 模块         | 职责                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| `objects`    | 游戏自定义对象 schema、带类别/会话的引用；关系的端点、基数、环和删除策略；受限编辑 |
| `values`     | 类型化派生值、数值加法/乘法修正、来源/流程生命周期、显式依赖追踪和循环检测         |
| `operations` | 类型化请求、输入解析、写入授权、前置调整/取消、事后反应、确定顺序和步数预算        |
| `flows`      | 显式步骤、等待选择、子流程、返回及故障；可序列化帧和随机状态                       |
| `registry`   | 分类注册、依赖检查、冻结、内容摘要与版本化规则集；JSON 参数绑定 TS 行为            |
| `session`    | 输入版本检查、隔离候选、领域校验、完整提交和快照恢复                               |
| `storage`    | 内存/Redis CAS、租约与 fencing、成功请求回执、接管与不确定提交恢复                 |
| `validation` | 外部 unknown 输入及有限、无环、普通 JSON 数据边界                                  |

最小游戏仍实现 `GameDefinition<State, Command, Fact>` 的 `parseState`、`parseCommand`、`decide`。`createSession` / `restoreSession` 提供 `submit`、类型化 `dispatch`、独立副本 `view` 和 `snapshot`。每次成功提交版本加一，拒绝或异常保留旧状态。`decide` 和操作实现属于可信引擎代码；内容作者通过受限行为接口提出请求。

## 自定义对象与校验

从引擎导入 `z` 和 `defineObject`，直接提交 schema。字段类型由同一 schema 推导；创建、读取和恢复时仍经过引擎的 JSON 边界与运行时校验。

```ts
import {
  z,
  defineObject,
  registration,
  RulesetBuilder,
  worldParser,
} from "@yuuinih/turn-kernel";

const barrierSchema = z.strictObject({
  durability: z.number().int().nonnegative(),
  element: z.enum(["fire", "ice"]),
});
type Barrier = z.infer<typeof barrierSchema>;
const barrier = defineObject("my-game:barrier", "1", barrierSchema);
const token = registration("object", barrier.kind, barrier.version, barrier);
const rules = new RulesetBuilder().add(token).build("my-game", "1");
const parseWorld = worldParser([rules.resolve(token)], []);
```

游戏声明领域字段和约束；引擎维护校验库依赖及其公开入口。现有 `(unknown) => T` 解析函数写法继续兼容。`z` 也可用于命令、流程局部变量和内容参数校验。schema 本身属于可信定义，不能存入对局快照；定义中的解析结果仍必须是普通 JSON。对象仍需接入规则集与世界校验器，当前没有自动模块发现。

## 自定义内容如何注册

先定义并注册 TS 对象、关系、值、操作、流程或行为，再把 JSON/YAML 解析结果绑定到行为参数。启动时组装并冻结规则集；每个对局固定规则集版本，运行中不热修改。

```ts
import {
  bindBehavior,
  defineBehavior,
  defineOperation,
  OperationRuntime,
  parse,
  registration,
  RulesetBuilder,
} from "@yuuinih/turn-kernel";

// 示例计数领域；真实游戏用带目标类别的治疗/伤害操作。
const add = defineOperation<number, number, number>({
  id: "example:add",
  version: "1",
  parse: (value) => parse.integer(value, 1),
  execute: (state, amount) => ({ state: state + amount, facts: [amount] }),
  authorize: (before, after, amount) => {
    if (after !== before + amount) throw Error("Unauthorized change");
  },
});
const operation = registration("operation", "example:add", "1", add.operation);
const behavior = defineBehavior<number, number>(
  "example:bonus",
  "1",
  (value) => parse.integer(value, 1),
  [{ id: "example:add", version: "1" }],
  (_query, amount) => [add.request(amount)],
);
const token = registration(
  "behavior",
  behavior.id,
  behavior.version,
  behavior,
  ["operation:example:add"],
);
const bonus = bindBehavior("example:small-bonus", token, JSON.parse("3"));
const rules = new RulesetBuilder()
  .add(operation)
  .add(token)
  .add(bonus.definition)
  .build("example", "1");
const runtime = new OperationRuntime(parse.integer, [rules.resolve(operation)]);
const result = runtime.execute(0, bonus.plan(rules, 0)); // state: 3
```

注册按类别与 ID 去重，依赖必须存在；解析时必须使用原注册 token。内容参数先验证，再纳入摘要。定义对象被深冻结，拒绝可变容器和访问器。TS 函数及其闭包仍是可信实现：修改实现必须提升版本，当前不会自动计算源代码哈希。YAML 解析器属于宿主适配层，解析输出仍走同一参数校验。内容数据可以独立用于检索和分析。

## 流程与值

`FlowRuntime.start(start, instanceId)` 要求宿主分配不会复用的执行 ID，并把分配计数保存在对局状态里。帧和选择标识包含该命名空间；恢复检查帧类型、版本、步骤和计数，提交选择检查 prompt、行动者及游戏定义的合法性。调用 `run` 得到 `fault` 时，游戏适配层应拒绝此次提交；精灵示例展示此处理。只能恢复显式检查点，不能恢复任意 TS 调用栈。

对象字段由游戏 schema 管理；字段不必全部变成数值表达式。需要派生、追踪或修正的字段注册为 value。数值修正先加后乘，再执行领域归一化。来源消失或流程结束时，游戏适配层清理失效修正。当前依赖通过 `observe` / `read` 显式记录，每次求值重新计算；没有自动字段探测或增量缓存，也没有恢复旧 config-value DSL。

## 服务器、Redis 与归档

先用 `store.create(session.snapshot())` 创建记录，再调用 `openDurableSession(game, store, sessionId, owner, parseFact)`。提交参数增加 `requestId`；同 ID 同原始载荷返回已提交结果，不同载荷拒绝。计算候选后，用版本 CAS 和租约 fencing 一次保存快照与回执，保存成功才返回成功。接管者从存储恢复；旧租约不能继续提交。响应丢失时查询回执，仍无法确定则返回 `storage-uncertain`，调用方必须使用同一请求重试。

`RedisStore` 接收 `RedisEval(script, keys, args)` 客户端适配函数，一次 Lua 调用更新单个对局 hash，使用 Redis 服务端时间检查租约。各对局可分布到不同工作进程；同一对局由存储版本和 fencing 仲裁。示例见 [存储合约测试](test/storage.test.ts)，真实游戏接管见 [精灵演示](https://github.com/YuuinIH/mindbug-lab/blob/main/src/pet-duel/demo.ts)。

JSON 快照可归档游戏状态并恢复等待步骤。若要保留在线重试语义，归档/迁移必须一并保留存储中的成功回执；单独导出 snapshot 不包含回执。当前未提供完整存储导出器、回执压缩/清理或历史规则集迁移。被拒绝的请求不持久化回执。Redis 的崩溃持久性由实际 AOF/复制等配置决定；Lua 原子性不承诺故障时零数据丢失。网络读取失败可抛错，宿主负责重试及服务可用性处理。

## 安全范围

- 类型和运行时边界拒绝错误对象类别、跨会话引用、过期版本和非法输入；正确的领域 schema 与授权实现仍由游戏负责。这不是任意 TS 代码绝对安全或状态机形式完备的证明。
- 规则只接触隔离副本。内容行为只能提出允许的操作；可信操作必须验证写入授权。没有恶意代码沙箱、CPU/内存隔离或外部副作用回滚；步数预算不能中止单个回调内部的死循环。
- 快照验证结构和领域不变量，不证明历史可达性，也不防伪。输入必须是有限无环的普通 JSON，拒绝访问器、稀疏数组、`NaN`、`Infinity`、负零等无法稳定归档的值。
- 会话 ID 与执行 ID 的唯一性由宿主保证。`owner` 应标识具体工作进程实例；不得让同时运行的进程共享同一个 owner。租约和版本不是用户身份认证。
- `view()` / snapshot 是完整调试数据，隐藏信息游戏需要另建玩家视图。当前不含房间、登录、匹配或客户端协议。

详见 [v0.2 范围](docs/spec-v2.md)、[审查记录](docs/review-v2.md) 和 [编码标准](CONTRIBUTING.md)。[v0.1 范围](docs/spec.md) 保留作为历史记录。
