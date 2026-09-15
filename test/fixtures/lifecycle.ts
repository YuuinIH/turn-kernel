import {
  z,
  defineFlow,
  defineOperation,
  FlowRuntime,
  OperationRuntime,
  parse,
  type FlowHooks,
  type FlowState,
  type GameDefinition,
} from "../../src/index.js";
export const stateSchema = z.strictObject({
  total: z.number().int(),
  log: z.array(z.string()),
});
export type State = z.infer<typeof stateSchema>;
export const inputSchema = z.strictObject({
  amount: z.number().int().min(0),
  label: z.string(),
});
export type Input = z.infer<typeof inputSchema>;
export const record = defineOperation<State, Input, string>({
  id: "record",
  version: "1",
  parse: (v) => inputSchema.parse(v),
  execute: (s, i) => ({
    state: { total: s.total + i.amount, log: [...s.log, i.label] },
    facts: [i.label],
  }),
  authorize(before, after, i) {
    if (
      after.total !== before.total + i.amount ||
      JSON.stringify(after.log) !== JSON.stringify([...before.log, i.label])
    )
      throw Error("Invalid log write");
  },
});
export interface SessionState {
  state: State;
  flow: FlowState;
}
export function fixture(hooks?: FlowHooks<State, Input, Input>) {
  const response = defineFlow<State, Input, Input>({
    id: "response",
    version: "1",
    entry: "choose",
    input: inputSchema,
    result: inputSchema,
    steps: {
      choose: {
        parseData: (v) => inputSchema.parse(v),
        parseChoice: (v) => z.boolean().parse(v),
        advance: (_s, f, choice) =>
          choice === undefined
            ? { kind: "wait", actor: "B", operations: [] }
            : {
                kind: "done",
                result: inputSchema.parse(f.data),
                operations: choice
                  ? [record.request({ amount: 1, label: "response" })]
                  : [],
              },
      },
    },
  });
  const hit = defineFlow<State, Input, Input>({
    id: "hit",
    version: "1",
    entry: "run",
    input: inputSchema,
    result: inputSchema,
    hooks: hooks ?? {
      before: {
        authorizeReplacement(_s, before, after) {
          if (before.label !== after.label)
            throw Error("Cannot replace target label");
        },
        handlers: [
          {
            id: "bonus",
            version: "1",
            order: 0,
            run(state, input) {
              state.total = 9999;
              return {
                kind: "replace",
                input: { ...input, amount: input.amount + 2 },
              };
            },
          },
        ],
      },
      after: {
        handlers: [
          {
            id: "a",
            version: "1",
            order: 0,
            operations: [record.operation],
            flows: [response],
            run(_s, event) {
              return [
                {
                  kind: "operation",
                  request: record.request({
                    amount: 0,
                    label: `after:${event.result.label}:${event.result.amount}`,
                  }),
                },
                { kind: "flow", start: response.start(event.input) },
                {
                  kind: "operation",
                  request: record.request({
                    amount: 0,
                    label: "after-response",
                  }),
                },
              ];
            },
          },
          {
            id: "z",
            version: "1",
            order: 0,
            operations: [record.operation],
            flows: [],
            run(state, event) {
              // @ts-expect-error A completed result is read-only at the public API.
              if (false) event.result.amount = 5000;
              const privateCopy = inputSchema.parse(event.result);
              privateCopy.amount = 5000;
              return [
                {
                  kind: "operation",
                  request: record.request({
                    amount: 0,
                    label: `observed:${state.total}`,
                  }),
                },
              ];
            },
          },
        ],
      },
    },
    steps: {
      run: {
        parseData: (v) => inputSchema.parse(v),
        advance: (_s, f) => ({
          kind: "done",
          result: f.data,
          operations: [record.request(inputSchema.parse(f.data))],
        }),
      },
    },
  });
  const parent = defineFlow<State, null, Input>({
    id: "parent",
    version: "1",
    entry: "first",
    input: z.null(),
    result: inputSchema,
    steps: {
      first: {
        advance: () => ({
          kind: "call",
          child: hit.start({ amount: 3, label: "first" }),
          resumeStep: "second",
          data: null,
          operations: [],
        }),
      },
      second: {
        advance: (_s, f) => ({
          kind: "done",
          result:
            f.childCancelled === null
              ? inputSchema.parse(f.childResult)
              : { amount: 0, label: f.childCancelled },
          operations: [
            record.request({ amount: 0, label: "parent-continued" }),
          ],
        }),
      },
    },
  });
  const engine = new FlowRuntime(
    [parent, hit, response],
    new OperationRuntime((v) => stateSchema.parse(v), [record.operation]),
  );
  const game: GameDefinition<SessionState, boolean | null, string> = {
    ruleset: "lifecycle-test/1",
    parseCommand: (v) => z.boolean().nullable().parse(v),
    parseState(v) {
      const s = parse.object(v, ["state", "flow"]);
      return { state: stateSchema.parse(s.state), flow: engine.parse(s.flow) };
    },
    decide(s, command) {
      const prompt = s.flow.prompt;
      const result =
        command === null
          ? engine.run(s)
          : engine.run(s, {
              promptId: prompt?.id ?? "",
              actor: "B",
              value: command,
            });
      return result.flow.status === "fault"
        ? { ok: false, reason: result.flow.error ?? "fault" }
        : {
            ok: true,
            state: { state: result.state, flow: result.flow },
            facts: result.facts,
          };
    },
  };
  return {
    engine,
    game,
    hit,
    response,
    initial: {
      state: { total: 0, log: [] },
      flow: engine.start(parent.start(null), "one"),
    },
  };
}
