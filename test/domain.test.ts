import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, type GameDefinition } from "../src/index.js";

type PetRef = { kind: "pet"; id: string };
type MarkRef = { kind: "mark"; id: string };
type Heal = { kind: "heal"; target: PetRef; amount: number };
type World = {
  pet: { id: string; hp: number };
  mark: { id: string; stacks: number };
};

// A second, deliberately tiny domain: the kernel has no knowledge of pets or marks.
const game: GameDefinition<World, Heal, { kind: "healed"; hp: number }> = {
  ruleset: "pet-fixture/1",
  parseState(input) {
    if (
      typeof input !== "object" ||
      input === null ||
      !("pet" in input) ||
      !("mark" in input)
    )
      throw Error("World");
    const { pet, mark } = input;
    if (
      typeof pet !== "object" ||
      pet === null ||
      !("id" in pet) ||
      pet.id !== "pet-1" ||
      !("hp" in pet) ||
      typeof pet.hp !== "number" ||
      !Number.isSafeInteger(pet.hp) ||
      pet.hp < 0 ||
      pet.hp > 10
    )
      throw Error("Pet");
    if (
      typeof mark !== "object" ||
      mark === null ||
      !("id" in mark) ||
      mark.id !== "mark-1" ||
      !("stacks" in mark) ||
      typeof mark.stacks !== "number" ||
      !Number.isSafeInteger(mark.stacks) ||
      mark.stacks < 0
    )
      throw Error("Mark");
    return {
      pet: { id: pet.id, hp: pet.hp },
      mark: { id: mark.id, stacks: mark.stacks },
    };
  },
  parseCommand(input) {
    if (
      typeof input !== "object" ||
      input === null ||
      !("kind" in input) ||
      input.kind !== "heal" ||
      !("target" in input) ||
      !("amount" in input) ||
      typeof input.amount !== "number" ||
      !Number.isSafeInteger(input.amount) ||
      input.amount <= 0
    )
      throw Error("Heal");
    const target = input.target;
    if (
      typeof target !== "object" ||
      target === null ||
      !("kind" in target) ||
      target.kind !== "pet" ||
      !("id" in target) ||
      typeof target.id !== "string"
    )
      throw Error("Pet target required");
    return {
      kind: "heal",
      target: { kind: "pet", id: target.id },
      amount: input.amount,
    };
  },
  decide(state, command) {
    if (command.target.id !== state.pet.id || state.pet.hp === 0)
      return { ok: false, reason: "Invalid or dead pet" };
    state.pet.hp = Math.min(10, state.pet.hp + command.amount);
    return { ok: true, state, facts: [{ kind: "healed", hp: state.pet.hp }] };
  },
};

test("a mark cannot be healed, including forged runtime input; legitimate healing preserves the mark", () => {
  const session = createSession(game, "battle", {
    pet: { id: "pet-1", hp: 5 },
    mark: { id: "mark-1", stacks: 2 },
  });
  const saved = session.snapshot();
  for (const target of [
    { kind: "mark", id: "mark-1" },
    { kind: "pet", id: "mark-1" },
  ]) {
    assert.equal(
      session.submit({
        sessionId: "battle",
        revision: 0,
        command: { kind: "heal", target, amount: 2 },
      }).ok,
      false,
    );
    assert.deepEqual(session.snapshot(), saved);
  }
  assert.equal(
    session.dispatch(
      { kind: "heal", target: { kind: "pet", id: "pet-1" }, amount: 3 },
      0,
    ).ok,
    true,
  );
  assert.deepEqual(session.view(), {
    pet: { id: "pet-1", hp: 8 },
    mark: { id: "mark-1", stacks: 2 },
  });
});

const mark: MarkRef = { kind: "mark", id: "mark-1" };
// @ts-expect-error Domain mismatch must fail compilation without an unsafe escape hatch.
const forbidden: Heal = { kind: "heal", target: mark, amount: 1 };
void forbidden;
