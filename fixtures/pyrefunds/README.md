# Python refunds fixture

The refund service of `fixtures/refunds`, in Python with `unittest`. It exists
to show that the change checks do not depend on TypeScript or Next.js: the
harness assessment runs this project's own tests, compares them with the base,
and reads risk signals from the diff, with no knowledge of Python.

Run the project's checks: `python3 -m unittest discover -s tests -t .`

| Variant | What it does | Tests | What catches it |
| --- | --- | --- | --- |
| `benign_refactor` | Names the limit constant | pass | nothing to catch |
| `support_fast_path` | Support agents skip manager approval | pass | the business rule (needs a specification), the path category (billing), a reviewer |
| `breaks_tests` | Allows a zero refund | **fail** | the project's tests, compared with the base |
| `drops_self_approval_guard` | Removes the self-approval `raise` | pass | the removed-guard signal, a reviewer |
| `raises_limit` | Approval limit 5000 → 50000 | pass | the changed-constant signal |

To use a variant, copy it over `refunds/service.py` (the first line is a comment).
