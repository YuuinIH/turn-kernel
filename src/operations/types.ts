import type { Parser } from "../validation/parse.js";
export interface OperationRequest {
  operation: string;
  version: string;
  input: unknown;
}
export interface OperationOutcome<S, F> {
  state: S;
  facts: readonly F[];
}
export interface Operation<S, F> {
  readonly id: string;
  readonly version: string;
  run(state: S, input: unknown): OperationOutcome<S, F>;
}
export interface OperationDefinition<S, I, F> {
  id: string;
  version: string;
  parse: Parser<I>;
  /** Trusted implementation. Only a detached candidate reaches this function. */
  execute(state: S, input: I): OperationOutcome<S, F>;
  /** Mandatory declared write-scope/invariant check, independent of the handler. */
  authorize(before: S, after: S, input: I): void;
}
export interface BeforeRule<S> {
  id: string;
  order: number;
  apply(state: S, request: OperationRequest): OperationRequest | null;
}
export interface ReactionRule<S, F> {
  id: string;
  order: number;
  react(state: S, fact: F): readonly OperationRequest[];
}
