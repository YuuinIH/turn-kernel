import type { FlowLifecycle, LifecycleCheckpoint } from "./lifecycle/types.js";
import type { OperationRequest } from "../operations/types.js";
/** One execution frame owns its serializable local data. */
export interface Frame<T = unknown> {
  id: string;
  type: string;
  version: string;
  step: string;
  data: T;
  childResult: unknown;
  childCancelled: string | null;
  lifecycle: LifecycleCheckpoint | null;
}
export interface Prompt {
  id: string;
  actor: string;
  frameId: string;
}
export interface FlowState {
  format: 2;
  instanceId: string;
  sequence: number;
  stack: Frame[];
  status: "running" | "waiting" | "finished" | "cancelled" | "fault";
  prompt: Prompt | null;
  result: unknown;
  error: string | null;
  cancellation: string | null;
}
export interface Choice {
  promptId: string;
  actor: string;
  value: unknown;
}
export interface StartFlow {
  type: string;
  version: string;
  step: string;
  data?: unknown;
}
export type Transition =
  | {
      kind: "next";
      step: string;
      data: unknown;
      operations: readonly OperationRequest[];
    }
  | { kind: "wait"; actor: string; operations: readonly OperationRequest[] }
  | {
      kind: "call";
      child: StartFlow;
      resumeStep: string;
      data: unknown;
      operations: readonly OperationRequest[];
    }
  | { kind: "done"; result: unknown; operations: readonly OperationRequest[] };
export interface FlowStep<S> {
  /** Omit only for steps whose data is null. */
  parseData?: (input: unknown) => unknown;
  parseChoice?: (input: unknown, state: S, frame: Frame) => unknown;
  advance(state: S, frame: Frame, choice: unknown): Transition;
}
export interface FlowDefinition<S> {
  readonly id: string;
  readonly version: string;
  readonly lifecycle?: FlowLifecycle<S>;
  readonly steps: Readonly<Record<string, FlowStep<S>>>;
}
export interface Execution<S> {
  state: S;
  flow: FlowState;
}
