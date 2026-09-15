import type { ZodType } from "../../validation/schema.js";
import type { OperationRequest } from "../../operations/types.js";
import type { StartFlow } from "../types.js";

export interface FlowIdentity {
  readonly id: string;
  readonly version: string;
}
export interface HookOccurrence {
  readonly frameId: string;
}
export type BeforeDecision<I> =
  | { kind: "continue" }
  | { kind: "replace"; input: I }
  | { kind: "cancel"; reason: string };
export interface BeforeHandler<
  S,
  I,
  D extends BeforeDecision<I> = BeforeDecision<I>,
> extends FlowIdentity {
  readonly order: number;
  run(state: S, input: Readonly<I>, occurrence: HookOccurrence): D;
}
export type FlowReaction =
  | { kind: "operation"; request: OperationRequest }
  | { kind: "flow"; start: StartFlow };
export interface AfterHandler<S, I, R> extends FlowIdentity {
  readonly order: number;
  readonly operations: readonly FlowIdentity[];
  readonly flows: readonly FlowIdentity[];
  run(
    state: S,
    event: {
      readonly input: Readonly<I>;
      readonly result: Readonly<R>;
      readonly frameId: string;
    },
  ): readonly FlowReaction[];
}
type Continue = { kind: "continue" };
type Cancel = { kind: "cancel"; reason: string };
type Replace<I> = { kind: "replace"; input: I };
type ReplacementAuthorizer<S, I> = (state: S, before: I, after: I) => void;
/** The declaration constrains handler results at compile time as well as runtime. */
export type BeforeHooks<S, I> =
  | {
      readonly handlers: readonly BeforeHandler<S, I, Continue>[];
      readonly cancel?: false;
      readonly authorizeReplacement?: never;
    }
  | {
      readonly handlers: readonly BeforeHandler<S, I, Continue | Cancel>[];
      readonly cancel: true;
      readonly authorizeReplacement?: never;
    }
  | {
      readonly handlers: readonly BeforeHandler<S, I, Continue | Replace<I>>[];
      readonly cancel?: false;
      readonly authorizeReplacement: ReplacementAuthorizer<S, I>;
    }
  | {
      readonly handlers: readonly BeforeHandler<S, I>[];
      readonly cancel: true;
      readonly authorizeReplacement: ReplacementAuthorizer<S, I>;
    };
export interface FlowHooks<S, I, R> {
  readonly before?: BeforeHooks<S, I>;
  readonly after?: { readonly handlers: readonly AfterHandler<S, I, R>[] };
}
export interface LifecycleDefinition<S, I, R> {
  readonly input: ZodType<I>;
  readonly result: ZodType<R>;
  readonly hooks?: FlowHooks<S, I, R>;
}
/** Runtime boundary erases generics only after schema validation. */
export interface FlowLifecycle<S> {
  readonly entry: string;
  readonly afterCount: number;
  parseInput(input: unknown): unknown;
  parseResult(input: unknown): unknown;
  before(
    state: S,
    input: unknown,
    frameId: string,
    spend: () => void,
  ): BeforeDecision<unknown>;
  after(
    index: number,
    state: S,
    input: unknown,
    result: unknown,
    frameId: string,
  ): readonly FlowReaction[];
  parseReactions(index: number, input: unknown): FlowReaction[];
  validateReferences(
    definitions: readonly FlowIdentity[],
    operations: readonly FlowIdentity[],
  ): void;
}
export type LifecycleCheckpoint =
  | { phase: "before" }
  | { phase: "body"; input: unknown }
  | {
      phase: "after";
      input: unknown;
      result: unknown;
      handler: number;
      pending: FlowReaction[];
      awaitingChild: boolean;
    };
