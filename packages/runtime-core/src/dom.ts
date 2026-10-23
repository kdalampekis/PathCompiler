import type { GuideEnvironment, GuideSignal, TargetSnapshot } from "./index.js";

export type DomEnvironmentOptions = {
  document?: Document;
  /** Current route. Defaults to `location.pathname`; pass the router's value in SPAs. */
  route?: () => string;
  /** Semantic target attribute. Defaults to `data-pathcompiler`. */
  attribute?: string;
};

/**
 * Observes semantic targets and user interactions in a DOM document. It only
 * reads the page and listens; it never clicks, types or navigates.
 */
export function createDomEnvironment(
  options: DomEnvironmentOptions = {},
): GuideEnvironment {
  const document = options.document ?? globalThis.document;
  if (!document)
    throw new Error(
      "createDomEnvironment needs a DOM document. Pass one explicitly outside the browser.",
    );
  const attribute = options.attribute ?? "data-pathcompiler";
  if (!/^data-[a-z0-9-]+$/.test(attribute))
    throw new Error(
      "Semantic target attribute must be a data-* attribute name.",
    );
  const view = document.defaultView;
  const route = options.route ?? (() => view?.location.pathname ?? "/");

  function visible(element: Element): boolean {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (node.hasAttribute("hidden")) return false;
      const style = view?.getComputedStyle(node);
      if (style && (style.display === "none" || style.visibility === "hidden"))
        return false;
    }
    return element.isConnected;
  }
  function snapshot(element: Element): TargetSnapshot {
    const control = element as Partial<HTMLInputElement>;
    const ariaChecked = element.getAttribute("aria-checked");
    return {
      visible: visible(element),
      enabled:
        control.disabled !== true &&
        element.getAttribute("aria-disabled") !== "true",
      checked:
        typeof control.checked === "boolean" &&
        (control.type === "checkbox" || control.type === "radio")
          ? control.checked
          : ariaChecked === "true"
            ? true
            : ariaChecked === "false"
              ? false
              : null,
      text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    };
  }

  return {
    route,
    query(target) {
      return [...document.querySelectorAll(`[${attribute}]`)]
        .filter((element) => element.getAttribute(attribute) === target)
        .map(snapshot);
    },
    subscribe(listener) {
      const changed = () => listener({ type: "change" });
      const interaction = (event: Event) => {
        const origin = event.target as Element | null;
        const element = origin?.closest?.(`[${attribute}]`);
        const target = element?.getAttribute(attribute);
        if (!target) return;
        listener({
          type: "interaction",
          target,
          kind: event.type as Extract<
            GuideSignal,
            { type: "interaction" }
          >["kind"],
        });
      };
      const observer = new (view?.MutationObserver ?? MutationObserver)(
        changed,
      );
      observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      const kinds = ["click", "input", "change"] as const;
      for (const kind of kinds)
        document.addEventListener(kind, interaction, true);
      view?.addEventListener("popstate", changed);
      view?.addEventListener("hashchange", changed);
      return () => {
        observer.disconnect();
        for (const kind of kinds)
          document.removeEventListener(kind, interaction, true);
        view?.removeEventListener("popstate", changed);
        view?.removeEventListener("hashchange", changed);
      };
    },
  };
}
