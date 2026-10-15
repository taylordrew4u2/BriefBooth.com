import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [390, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base);
    await page.getByRole("heading", { name: /Your expertise/ }).waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Home has horizontal overflow",
    );
    await page.getByText("Do my clients need an account?").click();
    await page
      .getByText(
        "No. They select a consultation, complete a short intake, and choose an available time.",
      )
      .waitFor();
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(base + "/book/demo");
  await page.getByRole("button", { name: /Discovery call/ }).click();
  await page
    .getByLabel("How would you like to meet?")
    .selectOption("in_person");
  await page.getByLabel("Your name").fill("Test Client");
  await page.getByLabel("Email address").fill("client@example.com");
  await page
    .getByLabel(/What would you like to discuss/)
    .fill("Help defining my next steps.");
  await page.getByRole("button", { name: "Choose a time" }).click();
  const dates = page.getByLabel(/Choose a date/);
  await dates.selectOption(
    await dates.locator("option").nth(2).getAttribute("value"),
  );
  await page.getByRole("button", { name: /9:00/ }).first().click();
  await page.getByRole("button", { name: "Try demo booking" }).click();
  await page
    .getByRole("heading", { name: "That’s how easy booking feels." })
    .waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: /Strategy session/ }).click();
  await page.getByRole("button", { name: "Back", exact: false }).click();
  await page.getByRole("heading", { name: "What can we help with?" }).waitFor();
  await page.goto(base + "/account?mode=signup");
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
  await page
    .getByRole("button", { name: "Already have an account? Sign in" })
    .click();
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByRole("heading", { name: "Reset your password" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: responsive homepage, FAQ disclosure, complete mobile demo booking, back navigation, account modes; no client errors.",
  );
} finally {
  await browser.close();
}
