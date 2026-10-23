// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createDomEnvironment, type GuideSignal } from "../src/index.js";

afterEach(() => {
  document.body.innerHTML = "";
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("DOM guide environment", () => {
  it("snapshots semantic targets without interacting with them", () => {
    document.body.innerHTML = `
      <button data-pathcompiler="save">  Save
        client </button>
      <button data-pathcompiler="save" disabled>Save</button>
      <div style="display:none"><span data-pathcompiler="hidden.parent">x</span></div>
      <span data-pathcompiler="hidden.self" hidden>x</span>
      <input type="checkbox" data-pathcompiler="agree" checked />
      <div role="switch" aria-checked="false" aria-disabled="true" data-pathcompiler="toggle"></div>
      <span data-pathcompiler='quote"d'>q</span>`;
    const environment = createDomEnvironment();
    expect(environment.query("save")).toEqual([
      { visible: true, enabled: true, checked: null, text: "Save client" },
      { visible: true, enabled: false, checked: null, text: "Save" },
    ]);
    expect(environment.query("hidden.parent")[0]?.visible).toBe(false);
    expect(environment.query("hidden.self")[0]?.visible).toBe(false);
    expect(environment.query("agree")[0]?.checked).toBe(true);
    expect(environment.query("toggle")[0]).toMatchObject({
      checked: false,
      enabled: false,
    });
    expect(environment.query('quote"d')).toHaveLength(1);
    expect(environment.query("missing")).toEqual([]);
    expect(environment.route()).toBe(location.pathname);
    expect(createDomEnvironment({ route: () => "/clients" }).route()).toBe(
      "/clients",
    );
  });

  it("reports target interactions, DOM changes and stops after unsubscribe", async () => {
    document.body.innerHTML = `
      <button data-pathcompiler="clients.create"><span id="inner">Create</span></button>
      <input data-pathcompiler="client.form.name" />
      <p id="plain">plain</p>`;
    const environment = createDomEnvironment();
    const signals: GuideSignal[] = [];
    const unsubscribe = environment.subscribe((signal) => signals.push(signal));
    document.getElementById("inner")?.click();
    const input = document.querySelector("input");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("plain")?.click();
    expect(signals).toEqual([
      { type: "interaction", target: "clients.create", kind: "click" },
      { type: "interaction", target: "client.form.name", kind: "input" },
      { type: "interaction", target: "client.form.name", kind: "change" },
    ]);
    document.body.append(document.createElement("div"));
    await flush();
    expect(signals.at(-1)).toEqual({ type: "change" });
    unsubscribe();
    const count = signals.length;
    document.getElementById("inner")?.click();
    document.body.append(document.createElement("div"));
    await flush();
    expect(signals).toHaveLength(count);
  });

  it("validates its configuration", () => {
    expect(() => createDomEnvironment({ attribute: "class" })).toThrow(
      "data-*",
    );
    const environment = createDomEnvironment({ attribute: "data-guide" });
    document.body.innerHTML = `<a data-guide="x">x</a><a data-pathcompiler="x">y</a>`;
    expect(environment.query("x")).toHaveLength(1);
  });
});
