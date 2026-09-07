import type { OperationRequest } from "../operations/types.js";
export interface Frame {
  id: string;
  type: string;
  version: string;
  step: string;
  locals: unknown;
  childResult: unknown;
}
export interface Prompt {
  id: string;
  actor: string;
  frameId: string;
}
export interface FlowState {
  instanceId: string;
  sequence: number;
  stack: Frame[];
  status: "running" | "waiting" | "finished" | "fault";
  prompt: Prompt | null;
  result: unknown;
  error: string | null;
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
  locals: unknown;
}
export type Transition =
  | {
      kind: "next";
      step: string;
      locals: unknown;
      operations: readonly OperationRequest[];
    }
  | { kind: "wait"; actor: string; operations: readonly OperationRequest[] }
  | {
      kind: "call";
      child: StartFlow;
      resumeStep: string;
      locals: unknown;
      operations: readonly OperationRequest[];
    }
  | { kind: "done"; result: unknown; operations: readonly OperationRequest[] };
export interface FlowStep<S> {
  parseLocals(input: unknown): unknown;
  parseChoice?: (input: unknown, state: S, frame: Frame) => unknown;
  advance(state: S, frame: Frame, choice: unknown): Transition;
}
export interface FlowDefinition<S> {
  readonly id: string;
  readonly version: string;
  readonly steps: Readonly<Record<string, FlowStep<S>>>;
}
export interface Execution<S> {
  state: S;
  flow: FlowState;
}
