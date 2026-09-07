# v0.2 review

Two independent read-only reviews checked implementation standards and the approved specification. Findings were fixed and then rechecked:

- Reject structural registration tokens and mutable containers/accessors; freeze nested definitions and manifest dependencies.
- Namespace flow frames and prompts by a persisted execution ID; reject cross-execution choices and malformed sequence checkpoints.
- Encode operation permission identity as an ID/version tuple to remove separator collisions.
- Reject pet flow faults at both command entries rather than committing a fault that blocks later play.

Regression tests cover each finding. The focused re-review found no remaining blockers in these fixes. Hosts must still allocate unique flow instance IDs; closures and game schemas remain trusted code. See README for persistence and safety limits.
