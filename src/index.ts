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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reject non-JSON values instead of silently dropping or rewriting them. */
function checkJson(value: unknown, parents = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null || parents.has(value)) throw Error('Not finite acyclic JSON');
  const proto: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw Error('Not a plain object');
  parents.add(value);
  const array = Array.isArray(value);
  if (array && Object.keys(value).length !== value.length) throw Error('Sparse or extended array');
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string') throw Error('Symbol key');
    if (array && (!Number.isInteger(Number(key)) || Number(key) < 0 ||
      Number(key) >= value.length || String(Number(key)) !== key)) throw Error('Non-index array property');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error('Accessor or hidden property');
    checkJson(descriptor.value, parents);
  }
  parents.delete(value);
}

function detached<T>(value: T): T {
  checkJson(value);
  return structuredClone(value);
}

function stateFrom<S, C, F>(game: GameDefinition<S, C, F>, value: unknown): S {
  return detached(game.parseState(detached(value)));
}

export function createSession<S, C, F>(
  game: GameDefinition<S, C, F>, sessionId: string, initial: unknown,
): Session<S, C, F> {
  if (!sessionId.trim() || !game.ruleset.trim()) throw Error('Session and ruleset must be nonempty');
  return host(game, sessionId, 0, stateFrom(game, initial));
}

export function restoreSession<S, C, F>(game: GameDefinition<S, C, F>, input: unknown): Session<S, C, F> {
  const saved = detached(input);
  if (!record(saved) || saved.format !== 1 || saved.ruleset !== game.ruleset ||
    typeof saved.sessionId !== 'string' || !saved.sessionId.trim() ||
    typeof saved.revision !== 'number' || !Number.isSafeInteger(saved.revision) || saved.revision < 0 ||
    Object.keys(saved).some(key => !['format', 'ruleset', 'sessionId', 'revision', 'state'].includes(key))) {
    throw Error('Invalid snapshot envelope or ruleset');
  }
  return host(game, saved.sessionId, saved.revision, stateFrom(game, saved.state));
}

function host<S, C, F>(game: GameDefinition<S, C, F>, sessionId: string, initialRevision: number, initial: S): Session<S, C, F> {
  let state = initial;
  let revision = initialRevision;
  let busy = false;
  function submit(input: unknown): Submission<F> {
    if (busy) return { ok: false, code: 'busy', reason: 'Reentrant submission' };
    busy = true;
    try { return execute(input); } finally { busy = false; }
  }
  function execute(input: unknown): Submission<F> {
    let command: C;
    try {
      const request = detached(input);
      if (!record(request) || typeof request.sessionId !== 'string' ||
        typeof request.revision !== 'number' || !Number.isSafeInteger(request.revision) || request.revision < 0 ||
        Object.keys(request).some(key => !['sessionId', 'revision', 'command'].includes(key))) {
        return { ok: false, code: 'invalid-input', reason: 'Invalid request envelope' };
      }
      if (request.sessionId !== sessionId) return { ok: false, code: 'wrong-session', reason: 'Session mismatch' };
      if (request.revision !== revision) return { ok: false, code: 'stale-revision', reason: 'Revision mismatch' };
      command = detached(game.parseCommand(request.command));
    } catch {
      return { ok: false, code: 'invalid-input', reason: 'Command validation failed' };
    }
    try {
      if (revision === Number.MAX_SAFE_INTEGER) throw Error('Revision exhausted');
      const decision = game.decide(detached(state), command);
      if (!decision.ok) return { ok: false, code: 'rejected', reason: decision.reason };
      // All validation/cloning completes before either authoritative field changes.
      const next = stateFrom(game, decision.state);
      const facts = detached(decision.facts);
      state = next;
      revision += 1;
      return { ok: true, revision, facts };
    } catch {
      return { ok: false, code: 'rule-failure', reason: 'Rule execution or candidate validation failed' };
    }
  }
  return {
    view: () => detached(state),
    snapshot: () => ({ format: 1, ruleset: game.ruleset, sessionId, revision, state: detached(state) }),
    dispatch: (command, expectedRevision) => submit({ sessionId, revision: expectedRevision, command }),
    submit,
  };
}
