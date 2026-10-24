import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { z } from "zod";
import { DemoSessionSchema } from "../lib/model";

const RecordIdSchema = z.object({ id: z.uuid() });

async function readSession(request: APIRequestContext) {
  const response = await request.get("/api/session");
  expect(response.ok()).toBe(true);
  return DemoSessionSchema.parse(await response.json());
}

async function createClient(page: Page, name = "Ada Lovelace") {
  await page.goto("/clients");
  await page.locator('[data-pathcompiler="clients.create"]').click();
  await page.locator('[data-pathcompiler="client.form.name"]').fill(name);
  await page
    .locator('[data-pathcompiler="client.form.email"]')
    .fill("ada@example.test");
  await page.locator('[data-pathcompiler="client.form.submit"]').click();
  await expect(
    page.locator('[data-pathcompiler="clients.feedback"]'),
  ).toHaveText("Client created");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test("Create, Edit and Deactivate Client with validation and modal cancellation", async ({
  page,
}) => {
  await page.goto("/clients");
  await page.locator('[data-pathcompiler="clients.create"]').click();
  await page.locator('[data-pathcompiler="client.form.submit"]').click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Name must contain at least 2 characters",
  );
  await page
    .locator('[data-pathcompiler="client.form.name"]')
    .fill("Ada Lovelace");
  await page
    .locator('[data-pathcompiler="client.form.email"]')
    .fill("ada@example.test");
  await page.locator('[data-pathcompiler="client.form.submit"]').click();
  await expect(
    page.locator('[data-pathcompiler="clients.feedback"]'),
  ).toHaveText("Client created");
  await page.locator('[data-pathcompiler="clients.edit"]').click();
  await page
    .locator('[data-pathcompiler="client.form.name"]')
    .fill("Ada Byron");
  await page.locator('[data-pathcompiler="client.form.submit"]').click();
  await expect(page.getByRole("heading", { name: "Ada Byron" })).toBeVisible();
  await page.locator('[data-pathcompiler="clients.deactivate"]').click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await page.locator('[data-pathcompiler="clients.deactivate"]').click();
  await page.locator('[data-pathcompiler="client.deactivate.confirm"]').click();
  await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
  await page.locator('[data-pathcompiler="nav.plans"]').click();
  await expect(
    page.locator('[data-pathcompiler="plans.create"]'),
  ).toBeDisabled();
});

test("Create Plan and Change Plan Structure through both branches", async ({
  page,
}) => {
  await page.goto("/plans");
  await expect(
    page.locator('[data-pathcompiler="plans.create"]'),
  ).toBeDisabled();
  await createClient(page);
  await page.locator('[data-pathcompiler="nav.plans"]').click();
  await page.locator('[data-pathcompiler="plans.create"]').click();
  await page.locator('[data-pathcompiler="plan.form.submit"]').click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .locator('[data-pathcompiler="plan.form.title"]')
    .fill("Autumn Plan");
  await page
    .locator('[data-pathcompiler="plan.form.client"]')
    .selectOption({ label: "Ada Lovelace" });
  await page.locator('[data-pathcompiler="plan.form.submit"]').click();
  await expect(page.locator('[data-pathcompiler="plans.feedback"]')).toHaveText(
    "Plan created",
  );
  await page.locator('[data-pathcompiler="plans.change_structure"]').click();
  await page
    .locator('[data-pathcompiler="plan.structure.selector"]')
    .selectOption("weekly");
  await page.locator('[data-pathcompiler="plan.structure.submit"]').click();
  await expect(
    page.getByText("Weekly structure", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator('[data-pathcompiler="plans.change_structure"]').click();
  await page
    .locator('[data-pathcompiler="plan.structure.selector"]')
    .selectOption("simple");
  await page.locator('[data-pathcompiler="plan.structure.submit"]').click();
  await expect(
    page.locator('[data-pathcompiler="plan.structure.confirm"]'),
  ).toBeVisible();
  await page.locator('[data-pathcompiler="dialog.close"]').click();
  await expect(
    page.getByText("Weekly structure", { exact: true }),
  ).toBeVisible();
  await page.locator('[data-pathcompiler="plans.change_structure"]').click();
  await page
    .locator('[data-pathcompiler="plan.structure.selector"]')
    .selectOption("simple");
  await page.locator('[data-pathcompiler="plan.structure.submit"]').click();
  await page.locator('[data-pathcompiler="plan.structure.back"]').click();
  await expect(
    page.locator('[data-pathcompiler="plan.structure.selector"]'),
  ).toHaveValue("simple");
  await page.locator('[data-pathcompiler="plan.structure.submit"]').click();
  await page.locator('[data-pathcompiler="plan.structure.confirm"]').click();
  await expect(
    page.getByText("Simple structure", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Simple structure", { exact: true }),
  ).toBeVisible();
});

test("viewer permissions are enforced in both UI and API", async ({
  page,
  context,
}) => {
  await createClient(page);
  const state = await readSession(context.request);
  const clientId = z.uuid().parse(state.clients[0]?.id);
  const planResponse = await context.request.post("/api/plans", {
    data: { title: "Permission plan", clientId },
  });
  expect(planResponse.status()).toBe(201);
  const planId = RecordIdSchema.parse(await planResponse.json()).id;
  await page.getByLabel("Role", { exact: true }).selectOption("viewer");
  await expect(
    page.getByRole("button", { name: "Create Client", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Client" })).toHaveCount(
    0,
  );
  expect(
    (
      await context.request.post("/api/clients", {
        data: { name: "Blocked", email: "blocked@example.test" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.patch(`/api/clients/${clientId}`, {
        data: { active: false },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post("/api/plans", {
        data: { title: "Blocked", clientId },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.patch(`/api/plans/${planId}`, {
        data: { structure: "weekly" },
      })
    ).status(),
  ).toBe(403);
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create Plan", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Change Plan Structure", exact: true }),
  ).toHaveCount(0);
});

test("feature flag and confirmation cannot be bypassed through the API", async ({
  page,
  context,
}) => {
  await createClient(page);
  const state = await readSession(context.request);
  const planResponse = await context.request.post("/api/plans", {
    data: { title: "Flag plan", clientId: state.clients[0]?.id },
  });
  expect(planResponse.status()).toBe(201);
  const id = RecordIdSchema.parse(await planResponse.json()).id;
  expect(
    (
      await context.request.patch(`/api/plans/${id}`, {
        data: { structure: "weekly" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.patch(`/api/plans/${id}`, {
        data: { structure: "simple" },
      })
    ).status(),
  ).toBe(409);
  const unchanged = await readSession(context.request);
  expect(unchanged.plans[0]?.structure).toBe("weekly");
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await page.getByLabel("Plan structure feature", { exact: true }).uncheck();
  await expect(
    page.getByText("Plan structure changes are disabled."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change Plan Structure", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await context.request.patch(`/api/plans/${id}`, {
        data: { structure: "simple", confirmed: true },
      })
    ).status(),
  ).toBe(403);
  await page.getByLabel("Plan structure feature", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Change Plan Structure", exact: true }),
  ).toBeVisible();
});

test("API rejects malformed input, missing records and inactive plan clients", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/clients", {
        data: { name: "A", email: "invalid" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/clients", {
        data: "{",
        headers: { "Content-Type": "application/json" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.patch("/api/clients/unknown", { data: { active: false } })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.patch("/api/plans/unknown", {
        data: { structure: "weekly" },
      })
    ).status(),
  ).toBe(404);
  const response = await request.post("/api/clients", {
    data: { name: "Inactive Client", email: "inactive@example.test" },
  });
  expect(response.status()).toBe(201);
  const clientId = RecordIdSchema.parse(await response.json()).id;
  expect(
    (
      await request.patch(`/api/clients/${clientId}`, {
        data: { active: false },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post("/api/plans", {
        data: { title: "Invalid plan", clientId },
      })
    ).status(),
  ).toBe(400);
  const state = await readSession(request);
  expect(state.plans).toEqual([]);
});

test("browser sessions have independent fixture state", async ({
  page,
  browser,
}) => {
  await createClient(page, "Private Session Client");
  const isolated = await browser.newContext({
    baseURL: "http://127.0.0.1:3100",
  });
  try {
    const other = await isolated.newPage();
    await other.goto("/clients");
    await expect(
      other.getByRole("heading", { name: "No clients yet" }),
    ).toBeVisible();
    await expect(other.getByText("Private Session Client")).toHaveCount(0);
  } finally {
    await isolated.close();
  }
});

test("repeated semantic actions resolve inside the selected client and plan rows", async ({
  page,
  context,
}) => {
  const request = context.request;
  await createClient(page, "First Client");
  await createClient(page, "Second Client");
  const session = await readSession(request);
  const selectedId = z
    .uuid()
    .parse(
      session.clients.find((client) => client.name === "Second Client")?.id,
    );
  await expect(page.locator('[data-pathcompiler="clients.edit"]')).toHaveCount(
    2,
  );
  const clientRow = page.locator(
    `[data-pathcompiler="clients.row"][data-client-id="${selectedId}"]`,
  );
  await clientRow.locator('[data-pathcompiler="clients.edit"]').click();
  await expect(
    page.locator('[data-pathcompiler="client.form.name"]'),
  ).toHaveValue("Second Client");
  await page
    .locator('[data-pathcompiler="client.form.name"]')
    .fill("Selected Client");
  await page.locator('[data-pathcompiler="client.form.submit"]').click();
  await expect(clientRow.getByRole("heading")).toHaveText("Selected Client");
  await expect(
    page.getByRole("heading", { name: "First Client", exact: true }),
  ).toBeVisible();

  for (const title of ["First Plan", "Selected Plan"]) {
    const response = await request.post("/api/plans", {
      data: { title, clientId: selectedId },
    });
    expect(response.status()).toBe(201);
  }
  const state = await readSession(request);
  const planId = z
    .uuid()
    .parse(state.plans.find((plan) => plan.title === "Selected Plan")?.id);
  await page.locator('[data-pathcompiler="nav.plans"]').click();
  await expect(
    page.locator('[data-pathcompiler="plans.change_structure"]'),
  ).toHaveCount(2);
  const planRow = page.locator(
    `[data-pathcompiler="plans.row"][data-plan-id="${planId}"]`,
  );
  await planRow.locator('[data-pathcompiler="plans.change_structure"]').click();
  await page
    .locator('[data-pathcompiler="plan.structure.selector"]')
    .selectOption("weekly");
  await page.locator('[data-pathcompiler="plan.structure.submit"]').click();
  await expect(planRow).toContainText("Weekly structure");
  await expect(
    page
      .locator('[data-pathcompiler="plans.row"]')
      .filter({ hasText: "First Plan" }),
  ).toContainText("Simple structure");
});

test("Deactivate Client from the edit dialog (alternative path)", async ({
  page,
}) => {
  await createClient(page);
  await page.locator('[data-pathcompiler="clients.edit"]').click();
  await page.locator('[data-pathcompiler="client.form.deactivate"]').click();
  await page.locator('[data-pathcompiler="client.deactivate.confirm"]').click();
  await expect(
    page.locator('[data-pathcompiler="clients.feedback"]'),
  ).toHaveText("Client deactivated");
});

test("admins archive plans only while the plan archive flag is on", async ({
  page,
  context,
}) => {
  await createClient(page);
  const state = await readSession(context.request);
  const planResponse = await context.request.post("/api/plans", {
    data: { title: "Archive plan", clientId: state.clients[0]?.id },
  });
  expect(planResponse.status()).toBe(201);
  const id = RecordIdSchema.parse(await planResponse.json()).id;
  await page.locator('[data-pathcompiler="nav.plans"]').click();
  await expect(page.locator('[data-pathcompiler="plans.archive"]')).toHaveCount(
    0,
  );
  expect(
    (await context.request.post(`/api/plans/${id}/archive`)).status(),
  ).toBe(403);
  await page.locator('[data-pathcompiler="demo.role"]').selectOption("admin");
  // Admins keep every editor action.
  await expect(
    page.locator('[data-pathcompiler="plans.create"]'),
  ).toBeVisible();
  await expect(page.locator('[data-pathcompiler="plans.archive"]')).toHaveCount(
    0,
  );
  expect(
    (await context.request.post(`/api/plans/${id}/archive`)).status(),
  ).toBe(403);
  await page.locator('[data-pathcompiler="demo.plan_archive"]').check();
  await page.locator('[data-pathcompiler="plans.archive"]').click();
  await expect(page.locator('[data-pathcompiler="plans.feedback"]')).toHaveText(
    "Plan archived",
  );
  expect(
    (await context.request.post(`/api/plans/${id}/archive`)).status(),
  ).toBe(409);
  await page.locator('[data-pathcompiler="demo.role"]').selectOption("editor");
  await expect(page.locator('[data-pathcompiler="plans.archive"]')).toHaveCount(
    0,
  );
});
