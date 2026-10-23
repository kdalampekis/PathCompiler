// Hand-encoded reference Formal Product Model for fixtures/next-demo, covering
// Create Client and Change Plan Structure (including the confirmation branch).
// Evidence cites real graph node IDs; R1's extracted model is compared to this.
import type { EvidenceRef } from "@pathcompiler/workflow-ir";
import { type FormalProductModel, f } from "../src/index.js";

type Kind = EvidenceRef["type"];
const NODES: Record<string, [Kind, string]> = {
  "route:/clients": ["route", "app/clients/page.tsx"],
  "route:/plans": ["route", "app/plans/page.tsx"],
  "api:POST:/api/clients": ["api", "app/api/clients/route.ts"],
  "api:POST:/api/plans": ["api", "app/api/plans/route.ts"],
  "api:PATCH:/api/plans/:id": ["api", "app/api/plans/[id]/route.ts"],
  "flag:planStructure": ["symbol", "Plans"],
  "permission:role:editor": ["symbol", "requireEditor"],
  "symbol:lib/session.ts#requireEditor": [
    "symbol",
    "lib/session.ts#requireEditor",
  ],
  "symbol:components/clients.tsx#Clients.submit": [
    "symbol",
    "components/clients.tsx#Clients.submit",
  ],
  "symbol:components/plans.tsx#Plans.changeStructure": [
    "symbol",
    "components/plans.tsx#Plans.changeStructure",
  ],
  "ui:nav.clients": ["symbol", "app/layout.tsx#RootLayout:Link[2]"],
  "ui:nav.plans": ["symbol", "app/layout.tsx#RootLayout:Link[3]"],
  "ui:clients.create": ["symbol", "components/clients.tsx#Clients:button[1]"],
  "ui:client.form": ["symbol", "components/clients.tsx#Clients:form[1]"],
  "ui:client.form.name": ["symbol", "components/clients.tsx#Clients:input[1]"],
  "ui:client.form.email": ["symbol", "components/clients.tsx#Clients:input[2]"],
  "ui:client.form.submit": [
    "symbol",
    "components/clients.tsx#Clients:button[4]",
  ],
  "ui:clients.feedback": ["symbol", "components/clients.tsx#Clients:p[1]"],
  "ui:plans.row": ["symbol", "components/plans.tsx#Plans:li[1]"],
  "ui:plans.change_structure": [
    "symbol",
    "components/plans.tsx#Plans:button[2]",
  ],
  "ui:plan.structure.form": ["symbol", "components/plans.tsx#Plans:form[2]"],
  "ui:plan.structure.selector": [
    "symbol",
    "components/plans.tsx#Plans:select[2]",
  ],
  "ui:plan.structure.submit": [
    "symbol",
    "components/plans.tsx#Plans:button[6]",
  ],
  "ui:plan.structure.confirm": [
    "symbol",
    "components/plans.tsx#Plans:button[4]",
  ],
  "ui:dialog.container": ["symbol", "components/modal.tsx#Modal:dialog[1]"],
  'test:tests/workflows.spec.ts#["Create, Edit and Deactivate Client with validation and modal cancellation"][1]':
    [
      "test",
      'test:tests/workflows.spec.ts#["Create, Edit and Deactivate Client with validation and modal cancellation"][1]',
    ],
  'test:tests/workflows.spec.ts#["Create Plan and Change Plan Structure through both branches"][1]':
    [
      "test",
      'test:tests/workflows.spec.ts#["Create Plan and Change Plan Structure through both branches"][1]',
    ],
  'test:tests/workflows.spec.ts#["viewer permissions are enforced in both UI and API"][1]':
    [
      "test",
      'test:tests/workflows.spec.ts#["viewer permissions are enforced in both UI and API"][1]',
    ],
  'test:tests/workflows.spec.ts#["feature flag and confirmation cannot be bypassed through the API"][1]':
    [
      "test",
      'test:tests/workflows.spec.ts#["feature flag and confirmation cannot be bypassed through the API"][1]',
    ],
};
export const CREATE_CLIENT_TEST =
  'test:tests/workflows.spec.ts#["Create, Edit and Deactivate Client with validation and modal cancellation"][1]';
export const PLAN_STRUCTURE_TEST =
  'test:tests/workflows.spec.ts#["Create Plan and Change Plan Structure through both branches"][1]';
const VIEWER_TEST =
  'test:tests/workflows.spec.ts#["viewer permissions are enforced in both UI and API"][1]';
const FLAG_TEST =
  'test:tests/workflows.spec.ts#["feature flag and confirmation cannot be bypassed through the API"][1]';

export function nextDemoFormalModel(commit: string): FormalProductModel {
  const at = (...ids: string[]): EvidenceRef[] =>
    ids.map((nodeId) => {
      const node = NODES[nodeId];
      if (!node) throw new Error(`Unknown evidence node ${nodeId}`);
      return {
        id: nodeId,
        type: node[0],
        locator: node[1],
        repositoryCommit: commit,
      };
    });
  const editor = f.is("role", "editor");
  const structureEnabled = f.var("plan_structure_enabled");
  const closeDialogs = [
    f.set("client_form_open", false),
    f.set("structure_dialog_open", false),
    f.set("confirmation_open", false),
  ];
  return {
    schemaVersion: 1,
    id: "next_demo",
    metadata: {
      repositoryCommit: commit,
      source: "hand-encoded",
      extractorVersion: "hand-encoded-r0",
    },
    variables: [
      {
        id: "role",
        type: "enum",
        values: ["editor", "viewer"],
        scope: "context",
        description: "Demo session role",
        evidence: at(
          "permission:role:editor",
          "symbol:lib/session.ts#requireEditor",
        ),
      },
      {
        id: "plan_structure_enabled",
        type: "boolean",
        scope: "context",
        description: "planStructure feature flag",
        evidence: at("flag:planStructure"),
      },
      {
        id: "current_area",
        type: "enum",
        values: ["OTHER", "CLIENTS", "PLANS"],
        scope: "state",
        evidence: at("route:/clients", "route:/plans"),
      },
      {
        id: "client_form_open",
        type: "boolean",
        scope: "state",
        evidence: at("ui:client.form"),
      },
      {
        id: "client_name_entered",
        type: "boolean",
        scope: "state",
        evidence: at("ui:client.form.name"),
      },
      {
        id: "client_email_entered",
        type: "boolean",
        scope: "state",
        evidence: at("ui:client.form.email"),
      },
      {
        id: "client_exists",
        type: "boolean",
        scope: "state",
        evidence: at("api:POST:/api/clients"),
      },
      {
        id: "plan_exists",
        type: "boolean",
        scope: "state",
        evidence: at("api:POST:/api/plans", "ui:plans.row"),
      },
      {
        id: "plan_structure",
        type: "enum",
        values: ["SIMPLE", "WEEKLY"],
        scope: "state",
        evidence: at("api:PATCH:/api/plans/:id"),
      },
      {
        id: "selected_structure",
        type: "enum",
        values: ["SIMPLE", "WEEKLY"],
        scope: "state",
        evidence: at("ui:plan.structure.selector"),
      },
      {
        id: "structure_dialog_open",
        type: "boolean",
        scope: "state",
        evidence: at("ui:plan.structure.form", "ui:dialog.container"),
      },
      {
        id: "confirmation_open",
        type: "boolean",
        scope: "state",
        evidence: at("ui:plan.structure.confirm"),
      },
      {
        id: "structure_changed",
        type: "boolean",
        scope: "state",
        description: "A structure change was saved during this session",
        evidence: at("api:PATCH:/api/plans/:id"),
      },
    ],
    // Plans may already exist with either structure; nothing is open at start.
    initial: f.and(
      f.is("current_area", "OTHER"),
      f.not(f.var("client_form_open")),
      f.not(f.var("client_name_entered")),
      f.not(f.var("client_email_entered")),
      f.not(f.var("client_exists")),
      f.not(f.var("structure_dialog_open")),
      f.not(f.var("confirmation_open")),
      f.not(f.var("structure_changed")),
    ),
    actions: [
      {
        id: "nav.open_clients",
        precondition: f.bool(true),
        effects: [f.set("current_area", "CLIENTS"), ...closeDialogs],
        semanticTarget: "nav.clients",
        evidence: at("ui:nav.clients", "route:/clients"),
      },
      {
        id: "nav.open_plans",
        precondition: f.bool(true),
        effects: [f.set("current_area", "PLANS"), ...closeDialogs],
        semanticTarget: "nav.plans",
        evidence: at("ui:nav.plans", "route:/plans"),
      },
      {
        id: "clients.open_create_form",
        precondition: f.and(
          f.is("current_area", "CLIENTS"),
          editor,
          f.not(f.var("client_form_open")),
        ),
        effects: [
          f.set("client_form_open", true),
          f.set("client_name_entered", false),
          f.set("client_email_entered", false),
        ],
        semanticTarget: "clients.create",
        capabilityId: "clients.create",
        evidence: at(
          "ui:clients.create",
          "permission:role:editor",
          CREATE_CLIENT_TEST,
        ),
      },
      {
        id: "clients.enter_name",
        precondition: f.var("client_form_open"),
        effects: [f.set("client_name_entered", true)],
        semanticTarget: "client.form.name",
        capabilityId: "clients.create",
        evidence: at("ui:client.form.name", CREATE_CLIENT_TEST),
      },
      {
        id: "clients.enter_email",
        precondition: f.var("client_form_open"),
        effects: [f.set("client_email_entered", true)],
        semanticTarget: "client.form.email",
        capabilityId: "clients.create",
        evidence: at("ui:client.form.email", CREATE_CLIENT_TEST),
      },
      {
        id: "clients.submit_create",
        description:
          "Server-side requireEditor guards the API as well as the UI",
        precondition: f.and(
          f.var("client_form_open"),
          f.var("client_name_entered"),
          f.var("client_email_entered"),
          editor,
        ),
        effects: [
          f.set("client_exists", true),
          f.set("client_form_open", false),
          f.set("client_name_entered", false),
          f.set("client_email_entered", false),
        ],
        semanticTarget: "client.form.submit",
        capabilityId: "clients.create",
        evidence: at(
          "ui:client.form.submit",
          "symbol:components/clients.tsx#Clients.submit",
          "api:POST:/api/clients",
          "symbol:lib/session.ts#requireEditor",
          CREATE_CLIENT_TEST,
        ),
      },
      {
        id: "plans.open_structure_editor",
        precondition: f.and(
          f.is("current_area", "PLANS"),
          f.var("plan_exists"),
          editor,
          structureEnabled,
          f.not(f.var("structure_dialog_open")),
        ),
        effects: [
          f.set("structure_dialog_open", true),
          f.set("selected_structure", f.ref("plan_structure")),
        ],
        semanticTarget: "plans.change_structure",
        capabilityId: "plans.change_structure",
        evidence: at(
          "ui:plans.change_structure",
          "flag:planStructure",
          "permission:role:editor",
          PLAN_STRUCTURE_TEST,
        ),
      },
      {
        id: "plans.select_weekly",
        precondition: f.and(
          f.var("structure_dialog_open"),
          f.not(f.var("confirmation_open")),
        ),
        effects: [f.set("selected_structure", "WEEKLY")],
        semanticTarget: "plan.structure.selector",
        capabilityId: "plans.change_structure",
        evidence: at("ui:plan.structure.selector", PLAN_STRUCTURE_TEST),
      },
      {
        id: "plans.select_simple",
        precondition: f.and(
          f.var("structure_dialog_open"),
          f.not(f.var("confirmation_open")),
        ),
        effects: [f.set("selected_structure", "SIMPLE")],
        semanticTarget: "plan.structure.selector",
        capabilityId: "plans.change_structure",
        evidence: at("ui:plan.structure.selector", PLAN_STRUCTURE_TEST),
      },
      {
        id: "plans.save_structure",
        description:
          "Direct save, except weekly → simple, which needs confirmation",
        precondition: f.and(
          f.var("structure_dialog_open"),
          f.not(f.var("confirmation_open")),
          f.neq(f.ref("selected_structure"), f.ref("plan_structure")),
          f.not(
            f.and(
              f.is("plan_structure", "WEEKLY"),
              f.is("selected_structure", "SIMPLE"),
            ),
          ),
          editor,
          structureEnabled,
        ),
        effects: [
          f.set("plan_structure", f.ref("selected_structure")),
          f.set("structure_dialog_open", false),
          f.set("structure_changed", true),
        ],
        semanticTarget: "plan.structure.submit",
        capabilityId: "plans.change_structure",
        evidence: at(
          "ui:plan.structure.submit",
          "symbol:components/plans.tsx#Plans.changeStructure",
          "api:PATCH:/api/plans/:id",
          PLAN_STRUCTURE_TEST,
        ),
      },
      {
        id: "plans.request_simplify",
        precondition: f.and(
          f.var("structure_dialog_open"),
          f.not(f.var("confirmation_open")),
          f.is("plan_structure", "WEEKLY"),
          f.is("selected_structure", "SIMPLE"),
        ),
        effects: [f.set("confirmation_open", true)],
        semanticTarget: "plan.structure.submit",
        capabilityId: "plans.change_structure",
        evidence: at(
          "ui:plan.structure.submit",
          "symbol:components/plans.tsx#Plans.changeStructure",
          FLAG_TEST,
        ),
      },
      {
        id: "plans.confirm_simplify",
        precondition: f.and(
          f.var("confirmation_open"),
          editor,
          structureEnabled,
        ),
        effects: [
          f.set("plan_structure", "SIMPLE"),
          f.set("confirmation_open", false),
          f.set("structure_dialog_open", false),
          f.set("structure_changed", true),
        ],
        semanticTarget: "plan.structure.confirm",
        capabilityId: "plans.change_structure",
        evidence: at(
          "ui:plan.structure.confirm",
          "api:PATCH:/api/plans/:id",
          PLAN_STRUCTURE_TEST,
          FLAG_TEST,
        ),
      },
    ],
    invariants: [
      {
        id: "clients.form_only_on_clients_page",
        description: "The client form is open only on the Clients page",
        condition: f.implies(
          f.var("client_form_open"),
          f.is("current_area", "CLIENTS"),
        ),
        evidence: at("ui:client.form", "route:/clients"),
      },
      {
        id: "plans.confirmation_inside_structure_dialog",
        description: "Confirmation appears only inside the structure dialog",
        condition: f.implies(
          f.var("confirmation_open"),
          f.var("structure_dialog_open"),
        ),
        evidence: at("ui:plan.structure.confirm", "ui:dialog.container"),
      },
      {
        id: "security.viewer_cannot_edit",
        description: "Viewers never hold an editing form open",
        condition: f.implies(
          f.is("role", "viewer"),
          f.and(
            f.not(f.var("client_form_open")),
            f.not(f.var("structure_dialog_open")),
          ),
        ),
        evidence: at(
          "permission:role:editor",
          "symbol:lib/session.ts#requireEditor",
          VIEWER_TEST,
        ),
      },
    ],
    goals: [
      {
        id: "clients.created",
        condition: f.var("client_exists"),
        businessMeaning: "A new client record exists",
        capabilityId: "clients.create",
        evidence: at(
          "ui:clients.feedback",
          "api:POST:/api/clients",
          CREATE_CLIENT_TEST,
        ),
        confidence: 1,
      },
      {
        id: "plans.structure_changed",
        condition: f.var("structure_changed"),
        businessMeaning: "An existing plan's structure was changed",
        capabilityId: "plans.change_structure",
        evidence: at(
          "api:PATCH:/api/plans/:id",
          "ui:dialog.container",
          PLAN_STRUCTURE_TEST,
        ),
        confidence: 0.9,
      },
    ],
  };
}
