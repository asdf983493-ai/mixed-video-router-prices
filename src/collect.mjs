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

async function clickMenuEntry(locator) {
  await locator.waitFor({ state: "attached", timeout: 15000 });
  await locator.evaluate(element => {
    const target = element.closest("button, a, [role='button']") || element;
    target.click();
  });
}

async function pageDiagnostic(page, response) {
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    status: response?.status?.() ?? null,
    body: bodyText.replace(/\s+/g, " ").trim().slice(0, 1200)
  };
}

async function loginIfNeeded(page, response) {
  const table = page.locator("table").filter({ hasText: "工作流" });
  if (await visible(table)) return;

  // 未登录时，登录框只有在进入「价格清单」后才会弹出。
  const priceEntry = page.getByText("价格清单", { exact: true }).first();
  if (await visible(priceEntry)) {
    await clickMenuEntry(priceEntry);
    await page.waitForTimeout(500);
  }

  const usernameInput = page.locator([
    'input[name="username"]', 'input[name="account"]', 'input[name="phone"]',
    'input[type="tel"]', 'input[autocomplete="username"]',
    'input[placeholder*="账号"]', 'input[placeholder*="手机"]', 'input[type="text"]'
  ].join(", ")).filter({ visible: true }).first();
  const passwordInput = page.locator('input[type="password"], input[autocomplete="current-password"]').filter({ visible: true }).first();

  try {
    await usernameInput.waitFor({ state: "visible", timeout: 15000 });
    await passwordInput.waitFor({ state: "visible", timeout: 15000 });
  } catch (error) {
    console.error("未找到登录框，页面诊断：", JSON.stringify(await pageDiagnostic(page, response)));
    throw error;
  }
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  const submit = page.locator("#loginOverlay button").filter({ hasText: /登录|登\s*录|sign\s*in|log\s*in/i }).last();
  await submit.waitFor({ state: "visible", timeout: 5000 });
  await submit.click();
  await page.locator("#loginOverlay").waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForTimeout(800);
}

async function openPriceTable(page) {
  const table = page.locator("table").filter({ hasText: "工作流" }).first();
  if (await visible(table)) return table;
  const priceEntry = page.getByText("价格清单", { exact: true }).first();
  await priceEntry.waitFor({ state: "visible", timeout: 15000 });
  await clickMenuEntry(priceEntry);
  await table.waitFor({ state: "visible", timeout: 15000 });
  const refresh = page.getByRole("button", { name: /刷新/ }).first();
  if (await visible(refresh)) {
    await refresh.evaluate(element => element.click());
    await page.waitForTimeout(1200);
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
  const context = await browser.newContext({
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  const response = await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await loginIfNeeded(page, response);
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
