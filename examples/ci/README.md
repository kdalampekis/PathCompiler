# CI examples

`candidate-verification.yml` shows the shape of a pull-request job for the
improvement loop's candidate evaluation: build the candidate, run
`verifyCandidateWorkflows` in a Playwright test, and pass the reports to
`pathcompiler evaluate --browser`. Adapt the build and test commands to your
application. PathCompiler does not deploy or run your application.
