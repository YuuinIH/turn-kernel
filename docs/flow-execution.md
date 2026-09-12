# Flow、Frame 与 Operation

本引擎面向回合制游戏。上层用 TypeScript 编写规则，不需要为每个行为建立 Phase 和 Context 配对。

- **FlowDefinition** 定义可推进、可等待的执行步骤。
- **Frame** 是某次流程调用的记录，保存 `step`、`data` 和 `childResult`。
- **Operation** 执行伤害、治疗、附着等受控修改；普通命令可以直接通过 OperationRuntime 运行，不需要一层只有一步的 Flow。
- 游戏中的回合、行动阶段、结束阶段由游戏决定。它们不等于引擎的事务边界。

## 局部状态

每个 Frame 独占一份可序列化 `data`，默认是 `null`。非空数据需要步骤的 `parseData` 验证。没有独立 Context 实体、全局当前 Context 或隐式父上下文查询。

调用 `start({ type, version, step }, instanceId)` 可以省略空数据；子流程也一样。持久化后的 Frame 始终包含 `data`。子流程有自己的 data，通过 `childResult` 显式向父流程返回结果，不共享父流程的可变局部对象。

```ts
const flow: FlowDefinition<State> = {
  id: "wait-for-player",
  version: "1",
  steps: {
    choose: {
      parseData: (value) => choiceStateSchema.parse(value),
      parseChoice: (value) => choiceSchema.parse(value),
      advance(_state, frame, choice) {
        const data = choiceStateSchema.parse(frame.data);
        if (choice === undefined) {
          return { kind: "wait", actor: data.player, operations: [] };
        }
        return { kind: "done", result: choice, operations: [] };
      },
    },
  },
};
```

示例中的 State 与 schema 由游戏定义。选择目标的领域合法性应在 `parseChoice(input, state, frame)` 或实际操作内检查。

回调得到状态和 Frame 的隔离副本。修改副本不会隐式保存；用 `next` 或 `call` 返回新的 data。要更新 data 后等待，可以先进入下一个等待步骤。只保存恢复所需的数据，不保存查询对象、函数、运行时服务或调用栈。

## 普通结算与等待

一次不暂停的伤害直接作为 Operation 执行。伤害参数、前置调整和返回事实属于此次结算，不需要成为流程实体。只有需要独立调度、暂停或恢复的过程才使用 Flow；无需把普通计算拆成多个步骤。

`run` 运行到等待、完成或故障。每次调用重新取得解析器、操作运行器和当前状态；这些执行设施不存入 Frame。等待后恢复必须使用相同规则集，验证选择 ID 和行动者，并重新校验仍可能变化的对象条件。

一次 `run` 的成功结果仍是候选状态，交给 Session 或 DurableSession 验证和提交。`fault` 由游戏适配层拒绝，保留之前的提交。整个游戏阶段不持有跨等待事务。

## 0.3 兼容边界

从 0.2 升级时：`Frame.locals`、`StartFlow.locals`、步骤转换结果的 `locals` 改名为 `data`；`parseLocals` 改为 `parseData`。游戏适配器需要重新构建。

新 FlowState 显式使用 `format: 1`。旧的无格式号/locals 快照不自动解释为新记录，会被拒绝；保留旧运行器读取旧存档，或编写并验证显式迁移。示例游戏提升了规则集修订，拒绝混用旧规则集存档。会话外层的 Snapshot 格式没有改变。

未来的格式变更必须显式处理，不能把字段改名悄悄当作兼容恢复。
