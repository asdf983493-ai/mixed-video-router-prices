import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { normalizePriceRows } from "./normalize.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "public", "prices.json");
const siteUrl = process.env.PRICE_SITE_URL || "https://old.nxrouyuan.top/";
const username = String(process.env.PRICE_SITE_USERNAME || "").trim();
const password = String(process.env.PRICE_SITE_PASSWORD || "");

if (!username || !password) throw new Error("缺少 PRICE_SITE_USERNAME 或 PRICE_SITE_PASSWORD");

async function visible(locator) {
  try { return await locator.first().isVisible({ timeout: 1500 }); } catch { return false; }
}

async function loginIfNeeded(page) {
  const table = page.locator("table").filter({ hasText: "工作流" });
  if (await visible(table)) return;

  const usernameInput = page.locator([
    'input[name="username"]', 'input[name="account"]', 'input[name="phone"]',
    'input[type="tel"]', 'input[autocomplete="username"]',
    'input[placeholder*="账号"]', 'input[placeholder*="手机"]', 'input[type="text"]'
  ].join(", ")).filter({ visible: true }).first();
  const passwordInput = page.locator('input[type="password"], input[autocomplete="current-password"]').filter({ visible: true }).first();

  await usernameInput.waitFor({ state: "visible", timeout: 15000 });
  await passwordInput.waitFor({ state: "visible", timeout: 15000 });
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  const submit = page.getByRole("button", { name: /登录|登\s*录|sign\s*in|log\s*in/i }).first();
  await submit.click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

async function openPriceTable(page) {
  const table = page.locator("table").filter({ hasText: "工作流" }).first();
  if (await visible(table)) return table;
  const priceEntry = page.getByRole("button", { name: /价格清单/ }).first();
  await priceEntry.waitFor({ state: "visible", timeout: 15000 });
  await priceEntry.click();
  await table.waitFor({ state: "visible", timeout: 15000 });
  const refresh = page.getByRole("button", { name: /刷新/ }).first();
  if (await visible(refresh)) {
    await refresh.click();
    await page.waitForTimeout(800);
  }
  return table;
}

async function extractRows(table) {
  return table.locator("tr").evaluateAll(rows => rows.slice(1).map(row => {
    const cells = [...row.querySelectorAll("th,td")].map(cell => cell.innerText.replace(/\s+/g, " ").trim());
    return {
      name: cells[0] || "",
      resolutions: cells[1] || "",
      billing: cells[2] || "",
      saleText: cells[3] || "",
      note: cells[4] || "",
      maxDuration: cells[5] || ""
    };
  }).filter(row => row.name));
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  const page = await context.newPage();
  await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await loginIfNeeded(page);
  const table = await openPriceTable(page);
  const rows = await extractRows(table);
  const models = normalizePriceRows(rows, { sourceHost: new URL(siteUrl).hostname });
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: "1.0",
    priceVersion: Date.now(),
    source: { name: "分镜图生成器 · 运境", host: new URL(siteUrl).hostname, url: siteUrl },
    checkedAt: now,
    publishedAt: now,
    modelCount: models.length,
    models
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`价格采集成功：${models.length} 个模型`);
} finally {
  await browser.close();
}
