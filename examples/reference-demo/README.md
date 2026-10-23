# Reference demo: the full PathCompiler loop

```sh
pnpm --filter @pathcompiler/reference-demo demo           # steps 1–14 as a narrative
pnpm --filter @pathcompiler/reference-demo test:browser   # also verifies the browser steps
```

The demo copies the reference fixture into a fresh Git repository
(`.work/app`, ignored) and runs the same public CLI and packages a customer would
use:

| # | Step | How |
| --- | --- | --- |
| 1 | Repository scan | `pathcompiler scan` |
| 2 | Product graph | `pathcompiler tests mine` (source and Playwright evidence graph) |
| 3 | Workflow discovery | `pathcompiler workflows discover` |
| 4 | Workflow approval | `pathcompiler workflows approve` ×3 |
| 5 | Compile | `pathcompiler build` |
| 6 | Query resolver | SDK static transport, `resolve()` |
| 7 | Custom assistant answer | `examples/custom-assistant` loop and card |
| 8 | Navigate action | browser: the answer's "Open /clients" opens the entry route |
| 9 | Interactive guide | browser: the runtime guides Create Client to completion |
| 10 | Code change | commit renaming `plans.change_structure` → `plans.restructure` |
| 11 | Impacted workflow detected | `pathcompiler impact` (high, `target-removed`) |
| 12 | Update proposal | `pathcompiler proposals generate` |
| 13 | Approval | `pathcompiler proposals accept` |
| 14 | New runtime output | `pathcompiler build`. In the browser, the new manifest guides the changed app, and the old one reports `target-missing` |

The browser suite serves the unchanged fixture (port 3104) and the changed copy
(port 3105) as production builds.
