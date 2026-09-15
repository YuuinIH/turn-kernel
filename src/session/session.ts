import { snapshotSchema, submissionSchema } from "./schemas.js";
import type { GameDefinition, Session, Submission } from "./types.js";
import { detached } from "../validation/json.js";

function stateFrom<S, C, F>(game: GameDefinition<S, C, F>, value: unknown): S {
  return detached(game.parseState(detached(value)));
}

export function createSession<S, C, F>(
  game: GameDefinition<S, C, F>,
  sessionId: string,
  initial: unknown,
): Session<S, C, F> {
  if (!sessionId.trim() || !game.ruleset.trim())
    throw Error("Session and ruleset must be nonempty");
  return host(game, sessionId, 0, stateFrom(game, initial));
}

export function restoreSession<S, C, F>(
  game: GameDefinition<S, C, F>,
  input: unknown,
): Session<S, C, F> {
  const saved = snapshotSchema.parse(detached(input));
  if (saved.ruleset !== game.ruleset)
    throw Error("Invalid snapshot envelope or ruleset");
  return host(
    game,
    saved.sessionId,
    saved.revision,
    stateFrom(game, saved.state),
  );
}

function host<S, C, F>(
  game: GameDefinition<S, C, F>,
  sessionId: string,
  initialRevision: number,
  initial: S,
): Session<S, C, F> {
  let state = initial;
  let revision = initialRevision;
  let busy = false;
  function submit(input: unknown): Submission<F> {
    if (busy)
      return { ok: false, code: "busy", reason: "Reentrant submission" };
    busy = true;
    try {
      return execute(input);
    } finally {
      busy = false;
    }
  }
  function execute(input: unknown): Submission<F> {
    let command: C;
    try {
      const request = submissionSchema.parse(detached(input));
      if (request.sessionId !== sessionId)
        return { ok: false, code: "wrong-session", reason: "Session mismatch" };
      if (request.revision !== revision)
        return {
          ok: false,
          code: "stale-revision",
          reason: "Revision mismatch",
        };
      command = detached(game.parseCommand(request.command));
    } catch {
      return {
        ok: false,
        code: "invalid-input",
        reason: "Command validation failed",
      };
    }
    try {
      if (revision === Number.MAX_SAFE_INTEGER)
        throw Error("Revision exhausted");
      const decision = game.decide(detached(state), command);
      if (!decision.ok)
        return { ok: false, code: "rejected", reason: decision.reason };
      // All validation/cloning completes before either authoritative field changes.
      const next = stateFrom(game, decision.state);
      const facts = detached(decision.facts);
      state = next;
      revision += 1;
      return { ok: true, revision, facts };
    } catch {
      return {
        ok: false,
        code: "rule-failure",
        reason: "Rule execution or candidate validation failed",
      };
    }
  }
  return {
    view: () => detached(state),
    snapshot: () => ({
      format: 1,
      ruleset: game.ruleset,
      sessionId,
      revision,
      state: detached(state),
    }),
    dispatch: (command, expectedRevision) =>
      submit({ sessionId, revision: expectedRevision, command }),
    submit,
  };
}
