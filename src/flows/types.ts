import type { z } from "../validation/schema.js";
import type {
  frameSchema,
  promptSchema,
  flowStateSchema,
  startFlowSchema,
} from "./schemas.js";
import type { FlowLifecycle } from "./lifecycle/types.js";
import type { OperationRequest } from "../operations/types.js";
/** One execution frame owns its serializable local data. */
export type Frame<T = unknown> = Omit<z.infer<typeof frameSchema>, "data"> & {
  data: T;
};
export type Prompt = z.infer<typeof promptSchema>;
export type FlowState = z.infer<typeof flowStateSchema>;
export interface Choice {
  promptId: string;
  actor: string;
  value: unknown;
}
export type StartFlow = z.infer<typeof startFlowSchema>;
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
