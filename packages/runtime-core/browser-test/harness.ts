import { createDomEnvironment, createGuideRuntime } from "../src/index.js";

Object.assign(window, {
  PathCompilerRuntime: { createDomEnvironment, createGuideRuntime },
});
