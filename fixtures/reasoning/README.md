# Reasoning evaluation cases

Reviewed cases for the formal reasoner (reasoning spec §88), one JSON file per
case in a category directory. Each case names a fixture next to this
directory, optional seeded `edits` (applied to a temporary copy, never the
fixture), one query and its expected answer. Run them with
`pathcompiler eval reasoning fixtures/reasoning`.

Write the expected answer from the product, not from the reasoner's output, and
add cases rather than editing them to make a run pass.
