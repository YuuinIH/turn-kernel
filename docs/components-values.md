# 组件、关系、派生值与 modifier（v0.4）

本轮目标：给回合制游戏提供可复用的数据能力，让精灵和防御塔共用生命组件及治疗操作；印记不具备生命能力。组件组合在对象定义时固定，不引入完整 ECS、动态组件增删、调度器或新的配置语言。不兼容旧示例快照。

## 对象与组件

```ts
const health = defineComponent(
  "health",
  "1",
  z
    .strictObject({
      hp: z.number().int().nonnegative(),
      maxHp: z.number().int().positive(),
    })
    .refine((v) => v.hp <= v.maxHp),
);
const pet = defineObject(
  "pet",
  "1",
  z.strictObject({
    health: health.schema(),
    name: z.string(),
  }),
  [health.slot("health")],
);
const healable = componentTarget(health, pet);
```

`schema()` 让字段直接推导类型；`slot()` 声明该字段承载哪个组件，`defineObject` 再次验证组件约束。每个对象中同一组件只能出现一次，字段不能重复使用。组件数据只存在于对象 value 中，没有另一份组件状态。组件及含组件对象的 schema 必须保持传入状态值不变；改变值的 transform、coerce、默认补值和删除字段会被拒绝。需要转换的原始输入由命令解析处理，再传入符合 schema 的规范数据。这保证反复读取和恢复不会重新转换存档。组件定义可以注册到 RulesetBuilder 的 `component` 分类；对象注册通过 `requires` 显式依赖组件。worldParser 拒绝冲突的组件定义、重复对象/关系定义和未声明的关系端点。

`componentTarget(health, pet, tower)` 显式列出该操作支持的对象定义，得到 `Ref<"pet" | "tower">` 的类型边界；构建时检查每个对象使用同一个组件定义。运行时仍要在当前 World 中检查引用存活与组件值，不把先前选中的引用当作永久授权。查询返回副本。

`WorldEditor.setComponent(target, ref, value)` 需要 `{ kind, component }` 写入许可；对象级许可和组件级许可分别声明。组件写入重跑整个对象 schema，保留对象级交叉字段约束。`authorizeComponentWrite(before, after, target, ref)` 是独立的最终校验：只允许这个对象的这一个组件发生变化，其他对象、字段、关系、身份和退休 ID 必须不变。操作仍需检查 World 以外的状态和领域规则。生命能力不意味着当前可治疗、可复活或有权治疗敌人。

## 关系

关系端点支持具体对象类别或 `{ component: "health" }`。World 验证器检查端点存活、组件成员资格、必需性、单值/多值、环和目标删除时的 restrict/detach/cascade 策略。不同对象类别可以参与同一组件关系。删除预先检查整个级联范围的对象和关系写权限，随后才修改候选。

关系是受管理的持久链接；普通临时 Ref 不必登记为关系。直接使用 `validateRelations` 的调用者若使用组件端点，必须提供组件成员查询；默认不会接受任何组件成员。

## 派生值与 modifier

`Evaluation.component(target, ref, state => state.world)` 从组件读取，并以组件 ID 和完整会话引用记录依赖；`read(otherValue, ref)` 记录派生值依赖并检测递归环。每个 Evaluation 捕获一个独立快照；新候选创建新的求值器。当前全部重新求值，没有增量缓存；依赖粒度是组件，未细化到组件字段。派生值仍绑定一个对象类别，计算代码可复用同一组件；没有引入跨类别的派生值注册协议。

`defineNumericValue(...).modifier(...)` 根据数值定义生成带目标类型检查的修正，调用者不再手写 valueId。`validateModifiers(input, definitions, liveRefs, activeFlows)` 在恢复和候选提交时统一拒绝重复 ID、非数值定义、错误目标类别、非法数值、失效来源/目标及已结束流程。它验证已声明的存活集合；宿主必须由已校验的 World 和 Flow 提供集合。

修正规则保持明确：按 ID 稳定排序，先相加、再相乘，最后由派生值定义钳制/取整。来源型修正随来源失效；流程型修正同时要求来源、目标、流程存活。清理由操作显式调用 `activeModifiers`，恢复时拒绝失效数据，不静默丢弃。没有 modifier 自带的脚本或另一套表达式语言。

## 验证要求

- 精灵/防御塔共用治疗；印记、伪造类别、跨会话和失效引用失败且快照不变。
- 组件写入保留其他组件；越权修改及非法跨字段数据被拒绝。
- 组件关系支持多个对象类别并在恢复、级联删除时保持约束。
- 派生值读取组件，修正参与计算；来源删除/流程结束清理，非法存档拒绝。
- 等待中的连击能 JSON 归档、由另一个工作进程接管；旧写入者被 fencing 拒绝。

规则仍是可信 TypeScript；这些边界不构成恶意代码沙箱或状态机的形式化完备证明。
