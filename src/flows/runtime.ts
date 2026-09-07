import { detached } from "../validation/json.js";
import { integer, list, object, text } from "../validation/parse.js";
import type { OperationRuntime } from "../operations/runtime.js";
import type {
  Choice,
  Execution,
  FlowDefinition,
  FlowState,
  Frame,
  StartFlow,
} from "./types.js";
export class FlowRuntime<S, F> {
  #definitions: Map<string, FlowDefinition<S>>;
  #operations: OperationRuntime<S, F>;
  constructor(
    definitions: readonly FlowDefinition<S>[],
    operations: OperationRuntime<S, F>,
  ) {
    this.#definitions = new Map(definitions.map((d) => [d.id, d]));
    this.#operations = operations;
    if (this.#definitions.size !== definitions.length)
      throw Error("Duplicate flow definition");
  }
  #step(frame: Frame) {
    const definition = this.#definitions.get(frame.type);
    const step = definition?.steps[frame.step];
    if (!definition || definition.version !== frame.version || !step)
      throw Error("Unknown flow/version/step");
    return step;
  }
  start(start: StartFlow, instanceId: string): FlowState {
    text(instanceId);
    const frame = {
      ...detached(start),
      id: identity(instanceId, "frame", 0),
      childResult: null,
    };
    frame.locals = detached(this.#step(frame).parseLocals(frame.locals));
    return {
      instanceId,
      sequence: 1,
      stack: [frame],
      status: "running",
      prompt: null,
      result: null,
      error: null,
    };
  }
  parse(input: unknown): FlowState {
    const v = object(input, [
      "instanceId",
      "sequence",
      "stack",
      "status",
      "prompt",
      "result",
      "error",
    ]);
    const sequence = integer(v.sequence, 1);
    const instanceId = text(v.instanceId);
    const stack = list(v.stack, (input) => {
      const f = object(input, [
        "id",
        "type",
        "version",
        "step",
        "locals",
        "childResult",
      ]);
      const frame: Frame = {
        id: text(f.id),
        type: text(f.type),
        version: text(f.version),
        step: text(f.step),
        locals: f.locals,
        childResult: detached(f.childResult),
      };
      frame.locals = detached(this.#step(frame).parseLocals(frame.locals));
      return frame;
    });
    for (const frame of stack)
      validateIdentity(frame.id, instanceId, "frame", sequence);
    if (new Set(stack.map((f) => f.id)).size !== stack.length)
      throw Error("Duplicate flow frame");
    const status = v.status;
    if (
      status !== "running" &&
      status !== "waiting" &&
      status !== "finished" &&
      status !== "fault"
    )
      throw Error("Unknown flow status");
    let prompt = null;
    if (v.prompt !== null) {
      const p = object(v.prompt, ["id", "actor", "frameId"]);
      prompt = {
        id: text(p.id),
        actor: text(p.actor),
        frameId: text(p.frameId),
      };
    }
    if (prompt) validateIdentity(prompt.id, instanceId, "choice", sequence);
    if (
      (status === "waiting") !== (prompt !== null) ||
      (prompt && prompt.frameId !== stack.at(-1)?.id) ||
      (status === "finished" ? stack.length !== 0 : stack.length === 0)
    )
      throw Error("Inconsistent flow checkpoint");
    if (status === "waiting" && !this.#step(stack.at(-1) ?? fail()).parseChoice)
      throw Error("Waiting step cannot receive input");
    if (status === "fault" ? typeof v.error !== "string" : v.error !== null)
      throw Error("Invalid fault record");
    return detached({
      instanceId,
      sequence,
      stack,
      status,
      prompt,
      result: v.result,
      error: v.error === null ? null : text(v.error),
    });
  }
  run(
    initial: Execution<S>,
    choice?: Choice,
    budget = 100,
  ): Execution<S> & { facts: readonly F[] } {
    integer(budget, 1, 10000);
    const flow = this.parse(initial.flow);
    let choiceValue: unknown = undefined;
    if (flow.status === "waiting") {
      const frame = flow.stack.at(-1) ?? fail();
      const parser = this.#step(frame).parseChoice;
      if (
        !choice ||
        choice.promptId !== flow.prompt?.id ||
        choice.actor !== flow.prompt.actor ||
        !parser
      )
        throw Error("Invalid or stale choice");
      choiceValue = detached(
        parser(
          detached(choice.value),
          detached(initial.state),
          detached(frame),
        ),
      );
      flow.prompt = null;
      flow.status = "running";
    } else if (choice || flow.status !== "running")
      throw Error("Flow does not accept this input");
    let state = detached(initial.state);
    const facts: F[] = [];
    try {
      for (let n = 0; n < budget; n += 1) {
        const frame = flow.stack.at(-1) ?? fail();
        const step = this.#step(frame);
        frame.locals = detached(step.parseLocals(frame.locals));
        const transition = step.advance(
          detached(state),
          detached(frame),
          choiceValue,
        );
        choiceValue = undefined;
        const outcome = this.#operations.execute(
          state,
          transition.operations,
          budget,
        );
        state = outcome.state;
        facts.push(...outcome.facts);
        switch (transition.kind) {
          case "next":
            frame.step = transition.step;
            frame.locals = detached(transition.locals);
            frame.childResult = null;
            break;
          case "wait": {
            if (!step.parseChoice)
              throw Error("Waiting step needs a choice parser");
            flow.prompt = {
              id: identity(flow.instanceId, "choice", flow.sequence++),
              actor: text(transition.actor),
              frameId: frame.id,
            };
            flow.status = "waiting";
            return { state, flow: this.parse(flow), facts };
          }
          case "call":
            frame.step = transition.resumeStep;
            frame.locals = detached(transition.locals);
            frame.childResult = null;
            flow.stack.push({
              ...detached(transition.child),
              id: identity(flow.instanceId, "frame", flow.sequence++),
              childResult: null,
            });
            break;
          case "done":
            flow.stack.pop();
            if (!flow.stack.length) {
              flow.status = "finished";
              flow.result = detached(transition.result);
              return { state, flow: this.parse(flow), facts };
            }
            (flow.stack.at(-1) ?? fail()).childResult = detached(
              transition.result,
            );
            break;
          default:
            exhaustive(transition);
        }
      }
      throw Error("Flow step budget exceeded");
    } catch (error) {
      // Roll back this whole advancement, preserving previous committed checkpoints.
      const rolledBack = detached(initial);
      rolledBack.flow.status = "fault";
      rolledBack.flow.prompt = null;
      rolledBack.flow.error =
        error instanceof Error ? error.message : "Flow execution failed";
      return { ...rolledBack, facts: [] };
    }
  }
}
function fail(): never {
  throw Error("Missing flow frame");
}
function exhaustive(value: never): never {
  throw Error(`Unknown transition ${String(value)}`);
}

function identity(instanceId: string, kind: string, sequence: number): string {
  return JSON.stringify([instanceId, kind, integer(sequence)]);
}
function validateIdentity(
  id: string,
  instanceId: string,
  kind: string,
  sequence: number,
): void {
  const parts: unknown = JSON.parse(id);
  if (
    !Array.isArray(parts) ||
    parts.length !== 3 ||
    parts[0] !== instanceId ||
    parts[1] !== kind ||
    typeof parts[2] !== "number" ||
    !Number.isSafeInteger(parts[2]) ||
    parts[2] < 0 ||
    parts[2] >= sequence ||
    id !== identity(instanceId, kind, parts[2])
  )
    throw Error("Invalid flow identity namespace or counter");
}
