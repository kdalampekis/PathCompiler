# ADR 0018 — Optional UI components

## Context

Phase 16 adds ProductHelpCard, WorkflowChecklist, GuideOverlay and WorkflowSearch.
They must be accessible, themeable and replaceable, and SDK users must not be
forced to depend on them.

## Decision

- Put the components in `@pathcompiler/ui`, which depends only on
  `@pathcompiler/react` (React as a peer). No core, SDK, runtime or adapter
  package depends on it, and a test enforces that.
- Build components only from public hooks, with no private runtime access, so
  an application can swap any one of them for its own.
- Accessibility comes from semantic HTML first: headings linked by
  `aria-labelledby`, ordered lists, `aria-current="step"`, visible "(done)"/
  "(current step)" text instead of colour alone, a labelled `<search>` form, and
  polite live regions for results and guide status. The guide panel is non-modal,
  so users can keep working. The highlight is decorative (`aria-hidden`,
  `pointer-events: none`).
- Theming is by class names, a `className` prop and CSS custom properties.
  Only the overlay sets inline styles, limited to what positioning requires. All
  text can be overridden through `labels`.
- Search resolves on submit rather than on every keystroke.

## Alternatives

- Ship a stylesheet: forces a styling approach and a build step on consumers.
- Use a component library or a headless-UI dependency: a heavy dependency for four
  components.
- A modal guide dialog: traps focus away from the product UI the user must operate.

## Consequences

Teams can use the components as-is, theme them, or replace them. Automated
accessibility auditing (for example axe) is not yet part of the suite. Coverage is
structural (roles, labels, states) in happy-dom.
