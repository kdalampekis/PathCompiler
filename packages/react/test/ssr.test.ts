import { createStaticTransport, PathCompiler } from "@pathcompiler/sdk-js";
import { compileWorkflows } from "@pathcompiler/workflow-compiler";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PathCompilerProvider,
  useGuideRuntime,
  useProductHelp,
  useWorkflowProgress,
} from "../src/index.js";

function Probe() {
  const progress = useWorkflowProgress();
  const guide = useGuideRuntime();
  const help = useProductHelp("add a client");
  return createElement(
    "p",
    null,
    `${progress.status}:${guide.state.status}:${help.status}`,
  );
}

describe("server rendering", () => {
  it("renders without a DOM and reports idle state", () => {
    expect(typeof document).toBe("undefined");
    const client = new PathCompiler({
      project: "ssr",
      transport: createStaticTransport(compileWorkflows([])),
    });
    expect(
      renderToString(
        createElement(
          PathCompilerProvider,
          { client, route: "/clients" },
          createElement(Probe),
        ),
      ),
    ).toBe("<p>idle:idle:loading</p>");
  });
});
