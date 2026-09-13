# v0.4 review

Baseline: turn-kernel `53ecdf5`, mindbug-lab `ada2e3c`.
Scope: `docs/components-values.md`; fixed component composition, component-qualified relations, derived reads and typed numeric modifiers. No compatibility layer or ECS scheduler.

## Standards

Independent review found no actionable violations of CONTRIBUTING.md or material code smells. Definitions, world access, final authorization, evaluation, and game rules remain separate modules. No unchecked assertions or explicit any added.

## Spec

Independent review found one P1: transforming component schemas were invoked repeatedly during reads and restore, potentially changing stored values. Fixed by rejecting noncanonical component inputs and object-level transformations on component-bearing objects. Raw input conversion belongs at command parsing. Review confirmed the fix; two misplaced compile-negative test directives were then moved to their actual error properties, and the full kernel check passed.

Validation: kernel 39 tests, zero skips with REQUIRE_REDIS=1 (including real Redis CAS/receipts/fencing); component regression covers transforms, repeated reads, JSON restore and failed-write immutability. Game checks and demos are recorded in the paired repository CI. No formal verification or hostile-code sandbox is claimed.
