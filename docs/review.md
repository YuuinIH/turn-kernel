# Initial experiment review

Reviewed initial implementation against docs/spec.md and CONTRIBUTING.md. The fixed starting point is 9ec4bcf (initial contract). Reviews were performed independently along Standards and Spec axes.

## Standards

Two initial findings across the two repositories: sparse arrays could disguise a hole with an extra enumerable property; the game subset accepted excess life. Both were reproduced, fixed and covered by regression tests. The Standards reviewer rechecked the fixes and reported no remaining actionable findings in scope.

## Spec

Two initial findings: the same array round-trip defect, and oversized restored hands in the supported game subset. Both were fixed with public-interface regression tests. Full checks after changes passed.

## Validation

Kernel: strict typecheck plus 8 behavior tests, including the separate pet/mark domain fixture. Game: strict typecheck plus 12 behavior tests; the generated-game test runs 12 complete games and compares every decision after JSON snapshot restoration. These are bounded experiments, not a proof of arbitrary game correctness.

No source/test use of explicit any, double assertions, ts-ignore or unchecked type assertions. Deliberate ts-expect-error examples establish illegal domain combinations at compile time.
