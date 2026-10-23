import {
  createDomEnvironment,
  createGuideRuntime,
} from "@pathcompiler/runtime-core";

Object.assign(window, {
  PathCompilerRuntime: { createDomEnvironment, createGuideRuntime },
});
