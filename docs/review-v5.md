# v0.5 review

Baselines: kernel 43ad907; lab aba0df4. Requirement: every derived value must belong to a component. Scope and API: components-values.md.

Independent Standards and Spec reviews passed. Spec reviewer also ran the 11 component/value tests. A compile-negative check identified lost reference-kind inference after removing the single kind field; keeping the target's readonly kinds on definitions restored static rejection and is covered by the typecheck.

Complete local kernel check: 41 passing tests, zero skips, with REQUIRE_REDIS=1. Paired game validation covers component healing, modifiers, waiting checkpoint restoration, worker takeover, and unchanged Mindbug behavior. No compatibility adapter is retained.
