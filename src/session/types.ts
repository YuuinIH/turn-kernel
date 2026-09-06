/** Trusted game modules define semantics; this host owns the committed state. */
export type Decision<S, F> =
  | { ok: true; state: S; facts: readonly F[] }
  | { ok: false; reason: string };

export interface GameDefinition<S, C, F> {
  readonly ruleset: string;
  readonly parseState: (input: unknown) => S;
  readonly parseCommand: (input: unknown) => C;
  readonly decide: (state: S, command: C) => Decision<S, F>;
}

export interface Snapshot<S> {
  format: 1;
  ruleset: string;
  sessionId: string;
  revision: number;
  state: S;
}

export type Submission<F> =
  | { ok: true; revision: number; facts: readonly F[] }
  | { ok: false; code: 'invalid-input' | 'wrong-session' | 'stale-revision' | 'rejected' | 'rule-failure' | 'busy'; reason: string };

export interface Session<S, C, F> {
  view(): S;
  snapshot(): Snapshot<S>;
  dispatch(command: C, revision: number): Submission<F>;
  submit(input: unknown): Submission<F>;
}

