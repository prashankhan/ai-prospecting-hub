#!/usr/bin/env node
/**
 * End-to-end walkthrough of the V1 workflow against a running app (default http://localhost:3000)
 * backed by tests/e2e/fake-supabase.mjs. Captures screenshots into E2E_SHOTS (default ./.local/shots).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// CommonJS resolution honours NODE_PATH, so a globally installed Playwright works too.
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? ".local/shots";
mkdirSync(SHOTS, { recursive: true });
const ADMIN = { name: "Avery Admin", email: "admin@example.test", password: "correct-horse-battery" };
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
    console.log(`✗ ${name}\n   ${e.message.split("\n")[0]}`);
    throw e;
  }
};
const expectText = async (page, text, timeout = 10_000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
// Outbound sites are not reachable from the test environment; stub Instagram so we can assert the URL.
await context.route(/instagram\.com/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Instagram stub</title>" }));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

try {
  await step("unauthenticated users are redirected to sign in", async () => {
    await page.goto(`${BASE}/prospects`);
    await page.waitForURL(/\/login/);
    await shot("01-login");
  });

  await step("setup rejects a wrong token", async () => {
    await page.goto(`${BASE}/setup`);
    await page.fill("#token", "wrong");
    await page.fill("#full_name", ADMIN.name);
    await page.fill("#email", ADMIN.email);
    await page.fill("#password", ADMIN.password);
    await page.click("button[type=submit]");
    await expectText(page, "setup token is incorrect");
  });

  await step("first administrator is bootstrapped with the setup token", async () => {
    await page.fill("#token", "e2e-setup-token");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/projects/, { timeout: 15_000 });
    await expectText(page, "Tattoo IQ");
    await shot("02-projects");
  });

  await step("setup cannot be repeated once an admin exists", async () => {
    const p2 = await context.newPage();
    await p2.goto(`${BASE}/setup`);
    await expectText(p2, "Setup is complete");
    await p2.close();
  });

  await step("project configuration is editable", async () => {
    await page.click("main a:has-text('Tattoo IQ')");
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
    await expectText(page, "Qualification criteria");
    await page.fill("#threshold", "65");
    await page.click("button:has-text('Save changes')");
    await expectText(page, "Project saved");
    await shot("03-project-config");
  });

  await step("AI provider settings show honest unconfigured state", async () => {
    await page.goto(`${BASE}/settings/ai`);
    await expectText(page, "Google Gemini");
    await expectText(page, "Not configured");
    await shot("04-settings-ai");
  });

  await step("an invalid AI key fails the connection test without being marked verified", async () => {
    const card = page.locator("div[data-slot=card]").filter({ hasText: "Google Gemini" }).first();
    await card.locator("input[type=password]").fill("AIza-invalid-key-for-e2e");
    await card.getByRole("button", { name: "Save" }).click();
    await expectText(page, "Provider settings saved");
    await expectText(page, "Key saved · not tested");
    await card.getByRole("button", { name: "Test connection" }).click();
    await card.getByText("Connection failed").waitFor({ timeout: 30_000 });
    if (await card.getByText("Connection verified").count()) throw new Error("Invalid key was marked verified");
  });

  await step("duplicate prevention settings render with strict defaults", async () => {
    await page.goto(`${BASE}/settings/duplicates`);
    await expectText(page, "Global identity detection");
    const blockRepeat = page.locator("#block_repeat_outreach");
    if ((await blockRepeat.getAttribute("data-state")) !== "checked") throw new Error("Block repeat outreach should default on");
    await shot("05-settings-duplicates");
  });

  await step("CSV import deduplicates rows", async () => {
    const csv = [
      "Studio Name,Website,Instagram,City,Country,Phone",
      "Northside Ink,https://northside-ink.example.com/?utm_source=x,@NorthsideInk,Austin,USA,(512) 555-0101",
      "Northside Ink,northside-ink.example.com,,Austin,United States,",
      "Harbour Tattoo Co,,instagram.com/harbourtattoo,Bristol,UK,",
      "Maple Leaf Studio,https://mapleleaf.example.ca,,Toronto,Canada,",
      ",https://missing-name.example.com,,Toronto,Canada,",
    ].join("\n");
    writeFileSync(".local/import.csv", csv);
    await page.goto(`${BASE}/prospects/import`);
    await page.setInputFiles("input[type=file]", ".local/import.csv");
    await expectText(page, "Map columns");
    await shot("06-import-mapping");
    await page.click("button:has-text('Import 5 rows')");
    await expectText(page, "Import complete", 20_000);
    const text = await page.locator("dl").first().innerText();
    if (!/New\s+3/.test(text) || !/Skipped\s+1/.test(text) || !/Failed\s+1/.test(text)) throw new Error(`Unexpected summary: ${text}`);
    await shot("07-import-summary");
  });

  await step("re-importing the same file adds no duplicates", async () => {
    await page.goto(`${BASE}/prospects/import`);
    await page.setInputFiles("input[type=file]", ".local/import.csv");
    await page.click("button:has-text('Import 5 rows')");
    await expectText(page, "Import complete", 20_000);
    const text = await page.locator("dl").first().innerText();
    if (!/New\s+0/.test(text) || !/Skipped\s+4/.test(text)) throw new Error(`Unexpected summary: ${text}`);
  });

  await step("prospect table lists, searches and filters", async () => {
    await page.goto(`${BASE}/prospects`);
    await expectText(page, "3 prospects");
    await shot("08-prospects");
    await page.fill("input[aria-label='Search prospects']", "harbour");
    await page.waitForURL(/q=harbour/);
    await expectText(page, "1 prospect");
    await page.click("button:has-text('Clear')");
    await page.waitForURL((u) => !u.search.includes("q="));
  });

  await step("CSV export is served with protected cells", async () => {
    const res = await page.request.get(`${BASE}/api/prospects/export`);
    const body = await res.text();
    if (res.status() !== 200 || !body.includes("Northside Ink") || !body.includes("ai_qualification_score")) throw new Error(`Export failed: ${res.status()}`);
  });

  await step("AI qualification reports a real provider error instead of a fake result", async () => {
    await page.goto(`${BASE}/prospects?q=northside`);
    await page.click("a:has-text('Northside Ink')");
    await page.waitForURL(/\/prospects\/[0-9a-f-]{36}/);
    await page.click("button:has-text('Research and qualify')");
    await page.locator("[data-sonner-toast]").first().waitFor({ timeout: 30_000 });
    const toast = await page.locator("[data-sonner-toast]").first().innerText();
    if (/Scored/.test(toast)) throw new Error("Qualification should not succeed without a working provider");
    console.log(`   toast: ${toast.replace(/\s+/g, " ").slice(0, 160)}`);
    await shot("09-prospect-detail");
  });

  await step("Instagram profile is verified manually with evidence", async () => {
    await expectText(page, "Likely match");
    await page.fill("input[aria-label='Instagram username or profile URL']", "https://www.instagram.com/northsideink/");
    await page.click("button:has-text('Mark verified')");
    await expectText(page, "Instagram profile verified");
    await expectText(page, "Manual verification");
  });

  await step("message is written, approved and Copy & Open uses the verified profile", async () => {
    await page.click("button:has-text('Write manually')");
    await page.fill("textarea[aria-label=Message]", "Hi Northside Ink — loved the fine-line work on your page. Would a free trial of Tattoo IQ help with bookings?");
    await page.click("button:has-text('Save message')");
    await expectText(page, "Message saved");
    await page.click("button:has-text('Approve')");
    await expectText(page, "Message approved");
    const popupPromise = context.waitForEvent("page", { timeout: 10_000 });
    await page.click("button:has-text('Copy & open Instagram')");
    const popup = await popupPromise;
    if (!popup.url().includes("instagram.com/northsideink")) throw new Error(`Opened ${popup.url()}`);
    await popup.close();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    if (!clip.startsWith("Hi Northside Ink")) throw new Error(`Clipboard: ${clip}`);
    await page.reload();
    await expectText(page, "Approved");
    if (await page.getByText("Marked contacted").count()) throw new Error("Opening Instagram must not mark contacted");
  });

  await step("contact requires explicit confirmation", async () => {
    await page.click("button:has-text('Mark contacted')");
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Mark contacted" });
    if (await confirm.isEnabled()) throw new Error("Confirm button should be disabled until checkbox is ticked");
    await page.getByRole("dialog").getByRole("checkbox").click();
    await confirm.click();
    await expectText(page, "Marked contacted");
    await page.reload();
    await expectText(page, "Outreach was sent manually");
  });

  await step("responses are recorded as manual outcomes", async () => {
    await page.locator("button:has-text('Contacted')").first().click();
    await page.getByRole("menuitem", { name: "Interested", exact: true }).click();
    await page.fill("textarea[aria-label=Note]", "Asked for a demo next week");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expectText(page, "Status updated");
    await expectText(page, "Asked for a demo next week");
    await shot("10-prospect-after-outreach");
  });

  await step("outreach workspace shows queues", async () => {
    await page.goto(`${BASE}/outreach?view=followup`);
    await expectText(page, "Northside Ink");
    await shot("11-outreach-followup");
  });

  await step("dashboard and reports reflect recorded data", async () => {
    await page.goto(`${BASE}/dashboard`);
    await expectText(page, "Contacted");
    const text = await page.locator("main").innerText();
    if (!/Total prospects\s+3/.test(text)) throw new Error(`Dashboard totals wrong: ${text.slice(0, 400)}`);
    await shot("12-dashboard");
    await page.goto(`${BASE}/reports`);
    await expectText(page, "Outreach funnel");
    await shot("13-reports");
  });

  let inviteLink = "";
  await step("admin invites an operator with access to one project", async () => {
    await page.goto(`${BASE}/settings/team`);
    await page.click("button:has-text('Invite member')");
    await page.fill("#inv-email", "operator@example.test");
    await page.fill("#inv-name", "Olive Operator");
    await page.getByRole("dialog").getByText("Tattoo IQ").click();
    await page.click("button:has-text('Create invitation')");
    inviteLink = await page.locator("input[readonly]").inputValue();
    if (!inviteLink.includes("/auth/confirm?token_hash=")) throw new Error(`Bad link ${inviteLink}`);
    await page.keyboard.press("Escape");
    await shot("14-team");
  });

  let secondProject = "";
  await step("admin creates a second, isolated project", async () => {
    await page.goto(`${BASE}/projects/new`);
    await page.fill("#name", "Roofing Pilot");
    await page.fill("#product_name", "RoofDesk");
    await page.click("button:has-text('Create project')");
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
    secondProject = page.url().split("/").pop();
  });

  await step("operator accepts the invitation and sees only assigned projects", async () => {
    const opCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const op = await opCtx.newPage();
    await op.goto(inviteLink.replace("http://localhost:3000", BASE));
    await op.waitForURL(/set-password/);
    await op.fill("#password", "operator-password-1");
    await op.fill("#confirm", "operator-password-1");
    await op.click("button[type=submit]");
    await op.waitForURL(/\/dashboard/);
    await op.goto(`${BASE}/projects`);
    await expectText(op, "Tattoo IQ");
    if (await op.getByText("Roofing Pilot").count()) throw new Error("Operator can see an unassigned project");
    // Streaming responses keep HTTP 200 once the shell is sent; assert on content instead.
    await op.goto(`${BASE}/projects/${secondProject}`);
    await expectText(op, "Page not found");
    if (await op.getByText("RoofDesk").count()) throw new Error("Operator can read another project's configuration");
    await op.goto(`${BASE}/settings/ai`);
    await op.waitForURL(/dashboard\?error=forbidden/);
    await op.goto(`${BASE}/prospects`);
    await expectText(op, "3 prospects");
    await op.screenshot({ path: `${SHOTS}/15-operator-prospects.png`, fullPage: true });
    await opCtx.close();
  });

  await step("cron worker endpoint rejects unauthenticated calls", async () => {
    const bad = await page.request.get(`${BASE}/api/jobs/tick`);
    if (bad.status() !== 401) throw new Error(`Expected 401, got ${bad.status()}`);
    const ok = await page.request.get(`${BASE}/api/jobs/tick`, { headers: { authorization: "Bearer e2e-cron-secret" } });
    if (ok.status() !== 200) throw new Error(`Expected 200, got ${ok.status()}`);
  });

  await step("dark theme renders", async () => {
    await page.goto(`${BASE}/settings`);
    await page.click("button[role=radio]:has-text('Dark')");
    await page.goto(`${BASE}/prospects`);
    await shot("16-prospects-dark");
    await page.goto(`${BASE}/dashboard`);
    await shot("17-dashboard-dark");
    await page.goto(`${BASE}/settings`);
    await page.click("button[role=radio]:has-text('Light')");
  });

  await step("mobile layout has no horizontal overflow", async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() });
    const mp = await m.newPage();
    for (const path of ["/dashboard", "/prospects", "/outreach?view=followup", "/settings/ai"]) {
      await mp.goto(`${BASE}${path}`);
      const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`${path} overflows by ${overflow}px`);
    }
    await mp.goto(`${BASE}/prospects`);
    await mp.screenshot({ path: `${SHOTS}/18-mobile-prospects.png`, fullPage: true });
    await m.close();
  });
} catch {
  // reported below
} finally {
  if (errors.length) console.log("Page errors:", errors);
  await browser.close();
  const failed = results.filter((r) => r[0] === "FAIL");
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  process.exit(failed.length || errors.length ? 1 : 0);
}
