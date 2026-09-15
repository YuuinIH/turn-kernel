import { isDeepStrictEqual } from "node:util";
import { detached } from "../validation/json.js";
import { integer, text } from "../validation/parse.js";
import type { FlowDefinition, FlowState, Frame, StartFlow } from "./types.js";
import {
  flowIdentitySchema,
  flowStateSchema,
  lifecycleCheckpointSchema,
  startFlowSchema,
} from "./schemas.js";
import type { LifecycleCheckpoint } from "./lifecycle/types.js";

export function identity(
  instanceId: string,
  kind: string,
  sequence: number,
): string {
  return JSON.stringify([instanceId, kind, integer(sequence)]);
}
function validateIdentity(
  id: string,
  instanceId: string,
  kind: string,
  sequence: number,
): void {
  const parsed = flowIdentitySchema.safeParse(JSON.parse(id));
  if (!parsed.success)
    throw Error("Invalid flow identity namespace or counter");
  const parts = parsed.data;
  if (
    parts[0] !== instanceId ||
    parts[1] !== kind ||
    parts[2] >= sequence ||
    id !== identity(instanceId, kind, parts[2])
  )
    throw Error("Invalid flow identity namespace or counter");
}
export class FlowCheckpointCodec<S> {
  #definitions: Map<string, FlowDefinition<S>>;
  constructor(definitions: readonly FlowDefinition<S>[]) {
    this.#definitions = new Map(definitions.map((d) => [d.id, d]));
    if (this.#definitions.size !== definitions.length)
      throw Error("Duplicate flow definition");
  }
  definition(frame: Frame): FlowDefinition<S> {
    const d = this.#definitions.get(frame.type);
    if (
      !d ||
      d.version !== frame.version ||
      !Object.hasOwn(d.steps, frame.step)
    )
      throw Error("Unknown flow/version/step");
    return d;
  }
  step(frame: Frame) {
    const step = this.definition(frame).steps[frame.step];
    if (!step) throw Error("Missing flow step");
    return step;
  }
  data(frame: Frame): unknown {
    const parser = this.step(frame).parseData;
    if (parser) return detached(parser(detached(frame.data)));
    if (frame.data !== null)
      throw Error("Step without a data parser requires null data");
    return null;
  }
  frame(input: StartFlow, instanceId: string, sequence: number): Frame {
    const start = startFlowSchema.parse(detached(input));
    const frame: Frame = {
      id: identity(instanceId, "frame", sequence),
      type: text(start.type),
      version: text(start.version),
      step: text(start.step),
      data: start.data === undefined ? null : detached(start.data),
      childResult: null,
      childCancelled: null,
      lifecycle: null,
    };
    const lifecycle = this.definition(frame).lifecycle;
    if (lifecycle) {
      if (frame.step !== lifecycle.entry)
        throw Error("Lifecycle flow must start at its entry");
      frame.data = lifecycle.parseInput(frame.data);
      frame.lifecycle = { phase: "before" };
    }
    const data = this.data(frame);
    if (lifecycle && !isDeepStrictEqual(frame.data, data))
      throw Error("Lifecycle entry parser changed input");
    frame.data = data;
    return frame;
  }
  #lifecycle(frame: Frame, input: unknown): LifecycleCheckpoint | null {
    const d = this.definition(frame).lifecycle;
    if (!d) {
      if (input !== null) throw Error("Flow does not declare lifecycle");
      return null;
    }
    const v = lifecycleCheckpointSchema.parse(input);
    if (v.phase === "before") {
      if (
        frame.step !== d.entry ||
        frame.childResult !== null ||
        frame.childCancelled !== null
      )
        throw Error("Invalid before checkpoint");
      frame.data = d.parseInput(frame.data);
      return { phase: "before" };
    }
    if (v.phase === "body") {
      return { phase: "body", input: d.parseInput(v.input) };
    }
    const handler = integer(v.handler, 0, d.afterCount);
    if (handler === 0 && v.pending.length)
      throw Error("Unexpected pending lifecycle reaction");
    const pending =
      handler === 0 ? [] : d.parseReactions(handler - 1, v.pending);
    if (v.awaitingChild && handler === 0)
      throw Error("Lifecycle child has no handler");
    return {
      phase: "after",
      input: d.parseInput(v.input),
      result: d.parseResult(v.result),
      handler,
      pending,
      awaitingChild: v.awaitingChild,
    };
  }
  parse(input: unknown): FlowState {
    const v = flowStateSchema.parse(detached(input));
    const { sequence, instanceId, status, prompt, cancellation } = v;
    const stack = v.stack.map((f) => {
      const frame: Frame = { ...f, lifecycle: null };
      if (frame.childCancelled !== null && frame.childResult !== null)
        throw Error("Cancelled child has a result");
      frame.lifecycle = this.#lifecycle(frame, f.lifecycle);
      frame.data = this.data(frame);
      return frame;
    });
    for (const [index, frame] of stack.entries()) {
      validateIdentity(frame.id, instanceId, "frame", sequence);
      const child = stack[index + 1];
      if (frame.lifecycle?.phase === "before" && child)
        throw Error("Before lifecycle cannot have a child");
      if (frame.lifecycle?.phase === "after") {
        if (frame.lifecycle.awaitingChild !== (child !== undefined))
          throw Error("Inconsistent lifecycle child checkpoint");
        if (child) {
          this.definition(frame).lifecycle?.parseReactions(
            frame.lifecycle.handler - 1,
            [
              {
                kind: "flow",
                start: {
                  type: child.type,
                  version: child.version,
                  step: child.step,
                  data: child.data,
                },
              },
            ],
          );
        }
        for (const action of frame.lifecycle.pending)
          if (action.kind === "flow")
            this.frame(action.start, instanceId, sequence);
      }
    }
    if (new Set(stack.map((f) => f.id)).size !== stack.length)
      throw Error("Duplicate flow frame");
    if (prompt) validateIdentity(prompt.id, instanceId, "choice", sequence);
    const terminal = status === "finished" || status === "cancelled";
    if (
      (status === "waiting") !== (prompt !== null) ||
      (prompt && prompt.frameId !== stack.at(-1)?.id) ||
      (terminal ? stack.length !== 0 : stack.length === 0)
    )
      throw Error("Inconsistent flow checkpoint");
    const top = stack.at(-1);
    if (
      status === "waiting" &&
      (!top ||
        !this.step(top).parseChoice ||
        (top.lifecycle !== null && top.lifecycle.phase !== "body"))
    )
      throw Error("Waiting step cannot receive input");
    if (status === "fault" ? v.error === null : v.error !== null)
      throw Error("Invalid fault record");
    if (
      (status === "cancelled") !== (cancellation !== null) ||
      (status !== "finished" && v.result !== null)
    )
      throw Error("Invalid flow outcome");
    return detached({
      format: 2,
      instanceId,
      sequence,
      stack,
      status,
      prompt,
      result: v.result,
      error: v.error === null ? null : text(v.error),
      cancellation,
    });
  }
}
