import { isDeepStrictEqual } from "node:util";
import { detached } from "../validation/json.js";
import { integer, text } from "../validation/parse.js";
import type { OperationRuntime } from "../operations/runtime.js";
import type {
  Choice,
  Execution,
  FlowDefinition,
  FlowState,
  Frame,
  StartFlow,
} from "./types.js";
import { FlowCheckpointCodec, identity } from "./checkpoint.js";

export class FlowRuntime<S, F> {
  #codec: FlowCheckpointCodec<S>;
  #operations: OperationRuntime<S, F>;
  constructor(
    definitions: readonly FlowDefinition<S>[],
    operations: OperationRuntime<S, F>,
  ) {
    this.#codec = new FlowCheckpointCodec(definitions);
    this.#operations = operations;
    for (const d of definitions)
      d.lifecycle?.validateReferences(definitions, operations.identities());
  }
  start(start: StartFlow, instanceId: string): FlowState {
    text(instanceId);
    return {
      format: 2,
      instanceId,
      sequence: 1,
      stack: [this.#codec.frame(start, instanceId, 0)],
      status: "running",
      prompt: null,
      result: null,
      error: null,
      cancellation: null,
    };
  }
  parse(input: unknown): FlowState {
    return this.#codec.parse(input);
  }
  #finish(flow: FlowState, result: unknown, cancelled: string | null): void {
    flow.stack.pop();
    const parent = flow.stack.at(-1);
    if (!parent) {
      flow.status = cancelled === null ? "finished" : "cancelled";
      flow.result = cancelled === null ? detached(result) : null;
      flow.cancellation = cancelled;
    } else if (parent.lifecycle?.phase === "after") {
      if (!parent.lifecycle.awaitingChild)
        throw Error("Unexpected lifecycle child completion");
      parent.lifecycle.awaitingChild = false;
    } else {
      parent.childResult = cancelled === null ? detached(result) : null;
      parent.childCancelled = cancelled;
    }
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
      const parser = this.#codec.step(frame).parseChoice;
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
    let remaining = budget;
    const spend = () => {
      if (--remaining < 0) throw Error("Flow step budget exceeded");
    };
    const execute = (
      requests: Parameters<OperationRuntime<S, F>["execute"]>[1],
    ) => {
      const outcome = this.#operations.execute(state, requests, budget);
      state = outcome.state;
      facts.push(...outcome.facts);
    };
    try {
      while (flow.status === "running") {
        spend();
        const frame = flow.stack.at(-1) ?? fail();
        const lifecycle = this.#codec.definition(frame).lifecycle;
        if (frame.lifecycle?.phase === "before") {
          if (!lifecycle) throw Error("Missing lifecycle definition");
          const decision = lifecycle.before(state, frame.data, frame.id, spend);
          if (decision.kind === "cancel") {
            this.#finish(flow, null, decision.reason);
            continue;
          }
          if (decision.kind !== "replace")
            throw Error("Invalid lifecycle input");
          frame.data = decision.input;
          frame.data = this.#codec.data(frame);
          if (!isDeepStrictEqual(frame.data, decision.input))
            throw Error("Lifecycle entry parser changed input");
          frame.lifecycle = { phase: "body", input: detached(frame.data) };
          continue;
        }
        if (frame.lifecycle?.phase === "after") {
          if (!lifecycle || frame.lifecycle.awaitingChild)
            throw Error("Invalid active after checkpoint");
          const checkpoint = frame.lifecycle;
          const action = checkpoint.pending.shift();
          if (action?.kind === "operation") execute([action.request]);
          else if (action?.kind === "flow") {
            checkpoint.awaitingChild = true;
            flow.stack.push(
              this.#codec.frame(action.start, flow.instanceId, flow.sequence++),
            );
          } else if (checkpoint.handler < lifecycle.afterCount) {
            checkpoint.pending = [
              ...lifecycle.after(
                checkpoint.handler,
                state,
                checkpoint.input,
                checkpoint.result,
                frame.id,
              ),
            ];
            checkpoint.handler += 1;
            if (checkpoint.pending.length > remaining)
              throw Error("Flow reaction budget exceeded");
          } else this.#finish(flow, checkpoint.result, null);
          continue;
        }
        const step = this.#codec.step(frame);
        frame.data = this.#codec.data(frame);
        const transition = step.advance(
          detached(state),
          detached(frame),
          choiceValue,
        );
        choiceValue = undefined;
        execute(transition.operations);
        switch (transition.kind) {
          case "next":
            frame.step = transition.step;
            frame.data = detached(transition.data);
            clearChild(frame);
            break;
          case "wait":
            if (!step.parseChoice)
              throw Error("Waiting step needs a choice parser");
            flow.prompt = {
              id: identity(flow.instanceId, "choice", flow.sequence++),
              actor: text(transition.actor),
              frameId: frame.id,
            };
            flow.status = "waiting";
            break;
          case "call":
            frame.step = transition.resumeStep;
            frame.data = detached(transition.data);
            clearChild(frame);
            flow.stack.push(
              this.#codec.frame(
                transition.child,
                flow.instanceId,
                flow.sequence++,
              ),
            );
            break;
          case "done":
            if (lifecycle && frame.lifecycle?.phase === "body") {
              frame.lifecycle = {
                phase: "after",
                input: frame.lifecycle.input,
                result: lifecycle.parseResult(transition.result),
                handler: 0,
                pending: [],
                awaitingChild: false,
              };
            } else this.#finish(flow, transition.result, null);
            break;
          default:
            exhaustive(transition);
        }
      }
      return { state, flow: this.parse(flow), facts };
    } catch (error) {
      const rolledBack = detached(initial);
      rolledBack.flow.status = "fault";
      rolledBack.flow.prompt = null;
      rolledBack.flow.error =
        error instanceof Error ? error.message : "Flow execution failed";
      return { ...rolledBack, facts: [] };
    }
  }
}
function clearChild(frame: Frame): void {
  frame.childResult = null;
  frame.childCancelled = null;
}
function fail(): never {
  throw Error("Missing flow frame");
}
function exhaustive(value: never): never {
  throw Error(`Unknown transition ${String(value)}`);
}
