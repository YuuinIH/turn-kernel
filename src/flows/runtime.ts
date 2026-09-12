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
  #data(frame: Frame): unknown {
    const parser = this.#step(frame).parseData;
    if (parser) return detached(parser(detached(frame.data)));
    if (frame.data !== null)
      throw Error("Step without a data parser requires null data");
    return null;
  }
  #frame(start: StartFlow, instanceId: string, sequence: number): Frame {
    const frame: Frame = {
      id: identity(instanceId, "frame", sequence),
      type: text(start.type),
      version: text(start.version),
      step: text(start.step),
      data: start.data === undefined ? null : detached(start.data),
      childResult: null,
    };
    frame.data = this.#data(frame);
    return frame;
  }
  start(start: StartFlow, instanceId: string): FlowState {
    text(instanceId);
    return {
      format: 1,
      instanceId,
      sequence: 1,
      stack: [this.#frame(start, instanceId, 0)],
      status: "running",
      prompt: null,
      result: null,
      error: null,
    };
  }
  parse(input: unknown): FlowState {
    const v = object(input, [
      "format",
      "instanceId",
      "sequence",
      "stack",
      "status",
      "prompt",
      "result",
      "error",
    ]);
    if (v.format !== 1)
      throw Error(
        "Unsupported flow checkpoint format; explicit migration required",
      );
    const sequence = integer(v.sequence, 1);
    const instanceId = text(v.instanceId);
    const stack = list(v.stack, (input) => {
      const f = object(input, [
        "id",
        "type",
        "version",
        "step",
        "data",
        "childResult",
      ]);
      const frame: Frame = {
        id: text(f.id),
        type: text(f.type),
        version: text(f.version),
        step: text(f.step),
        data: f.data,
        childResult: detached(f.childResult),
      };
      frame.data = this.#data(frame);
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
      format: 1,
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
        frame.data = this.#data(frame);
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
            frame.data = detached(transition.data);
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
            frame.data = detached(transition.data);
            frame.childResult = null;
            flow.stack.push(
              this.#frame(transition.child, flow.instanceId, flow.sequence++),
            );
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
