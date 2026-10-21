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
  await page
    .getByRole("button", { name: "Create Client", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
  await page.getByRole("button", { name: "Save Client" }).click();
  await expect(page.getByRole("status")).toHaveText("Client created");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test("Create, Edit and Deactivate Client with validation and modal cancellation", async ({
  page,
}) => {
  await page.goto("/clients");
  await page
    .getByRole("button", { name: "Create Client", exact: true })
    .click();
  await page.getByRole("button", { name: "Save Client" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Name must contain at least 2 characters",
  );
  await page.getByLabel("Name", { exact: true }).fill("Ada Lovelace");
  await page.getByLabel("Email", { exact: true }).fill("ada@example.test");
  await page.getByRole("button", { name: "Save Client" }).click();
  await expect(page.getByRole("status")).toHaveText("Client created");
  await page.getByRole("button", { name: "Edit Client" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ada Byron");
  await page.getByRole("button", { name: "Save Client" }).click();
  await expect(page.getByRole("heading", { name: "Ada Byron" })).toBeVisible();
  await page
    .getByRole("button", { name: "Deactivate Client", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Deactivate Client", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm Deactivation" }).click();
  await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create Plan", exact: true }),
  ).toBeDisabled();
});

test("Create Plan and Change Plan Structure through both branches", async ({
  page,
}) => {
  await page.goto("/plans");
  await expect(
    page.getByRole("button", { name: "Create Plan", exact: true }),
  ).toBeDisabled();
  await createClient(page);
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await page.getByRole("button", { name: "Create Plan", exact: true }).click();
  await page.getByRole("button", { name: "Save Plan" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Autumn Plan");
  await page
    .getByLabel("Client", { exact: true })
    .selectOption({ label: "Ada Lovelace" });
  await page.getByRole("button", { name: "Save Plan" }).click();
  await expect(page.getByRole("status")).toHaveText("Plan created");
  await page
    .getByRole("button", { name: "Change Plan Structure", exact: true })
    .click();
  await page.getByLabel("Structure", { exact: true }).selectOption("weekly");
  await page.getByRole("button", { name: "Save Structure" }).click();
  await expect(
    page.getByText("Weekly structure", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Change Plan Structure", exact: true })
    .click();
  await page.getByLabel("Structure", { exact: true }).selectOption("simple");
  await page.getByRole("button", { name: "Save Structure" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm Simplification" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByText("Weekly structure", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Change Plan Structure", exact: true })
    .click();
  await page.getByLabel("Structure", { exact: true }).selectOption("simple");
  await page.getByRole("button", { name: "Save Structure" }).click();
  await page.getByRole("button", { name: "Confirm Simplification" }).click();
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
