import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("lists projects and the product map with workflow coverage", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  const row = page.getByRole("row", { name: /demo/ });
  await expect(row.getByRole("cell").nth(2)).toHaveText("2");
  await row.getByRole("link", { name: "demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Product map" }),
  ).toBeVisible();
  const clients = page.getByRole("region", { name: "clients" });
  await expect(
    clients.getByRole("row", { name: /clients\.create/ }),
  ).toContainText("approved");
  await expect(
    clients.getByRole("row", { name: /clients\.edit/ }),
  ).toContainText("no workflow");
});

test("shows workflow detail with steps, evidence, confidence, commit and validation", async ({
  page,
}) => {
  await page.goto("/p/demo/workflows");
  await expect(page.getByRole("row", { name: /plans\.create/ })).toContainText(
    "candidate",
  );
  await page.getByRole("link", { name: "Create Client" }).click();
  await expect(
    page.getByRole("heading", { name: "Create Client" }),
  ).toBeVisible();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await expect(page.getByText("rule strength, not probability")).toBeVisible();
  const steps = page.getByRole("region", { name: "Steps" });
  await expect(steps.getByRole("row")).toHaveCount(5);
  await expect(steps).toContainText("components/clients.tsx#Clients:button[1]");
  await expect(steps).toContainText('clients.feedback shows "Client created"');
  const validation = page.getByRole("region", { name: "Validation report" });
  await expect(validation).toContainText("Valid at");
  await expect(
    validation.getByRole("row", { name: /testComparison/ }),
  ).toContainText("passed");
  await expect(
    page.getByRole("region", { name: "Pending diff" }),
  ).toContainText("No pending proposals.");
});

test("shows the pending diff and accepts the update proposal", async ({
  page,
}) => {
  await page.goto("/p/demo/workflows/plans.change_structure");
  await expect(
    page.getByRole("region", { name: "Pending diff" }),
  ).toContainText("+     target: plans.restructure");
  await page.getByRole("link", { name: "Pending changes" }).click();
  await expect(
    page.getByRole("region", { name: "Latest impact" }),
  ).toContainText("plans.change_structure");
  const proposal = page.getByRole("article", {
    name: /Update plans\.change_structure/,
  });
  await expect(proposal).toContainText("high");
  await proposal.getByLabel("Reviewer").fill("Ana Reviewer");
  await proposal.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("status")).toContainText("Accepted");
  await expect(page.getByRole("region", { name: /Proposals/ })).toContainText(
    "accepted by Ana Reviewer",
  );
  await page.goto("/p/demo/workflows/plans.change_structure");
  await expect(page.getByText("by Ana Reviewer")).toBeVisible();
  await expect(page.getByRole("region", { name: "Steps" })).toContainText(
    "plans.restructure",
  );
});

test("approves a candidate from its detail page", async ({ page }) => {
  await page.goto("/p/demo/workflows/plans.create");
  const review = page.getByRole("region", { name: "Review" });
  await expect(review).toContainText("input-binding-required");
  await review
    .getByRole("button", { name: "Approve" })
    .locator("..")
    .getByLabel("Reviewer")
    .fill("Bo");
  await review.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toContainText("Approved plans.create");
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Review" })).toHaveCount(0);
});

test("removes review controls once nothing is pending", async ({ page }) => {
  await page.goto("/p/demo/changes");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.goto("/p/demo/workflows/clients.create");
  await expect(page.getByRole("region", { name: "Review" })).toHaveCount(0);
});

test("lists evidence and settings", async ({ page }) => {
  await page.goto("/p/demo/evidence");
  await expect(page.getByText(/^symbol \(\d+\)$/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Playwright traces" }),
  ).toContainText("Create, Edit and Deactivate Client");
  await page.goto("/p/demo/settings");
  await expect(page.getByText("1.0.0")).toBeVisible();
  await expect(
    page.getByRole("row", { name: /runtime-manifest\.json/ }),
  ).not.toContainText("not built");
});

test("returns 404 for unknown projects and workflows", async ({ page }) => {
  expect((await page.goto("/p/missing"))?.status()).toBe(404);
  expect((await page.goto("/p/demo/workflows/clients.missing"))?.status()).toBe(
    404,
  );
  expect((await page.goto("/p/demo/workflows/..%2Fsecret"))?.status()).toBe(
    404,
  );
});
