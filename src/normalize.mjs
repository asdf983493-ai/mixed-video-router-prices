const NUMBER = String.raw`\d+(?:\.\d+)?`;

export function compactName(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "");
}

export function parseResolutions(value) {
  return [...new Set([...String(value || "").toUpperCase().matchAll(/(\d{3,4})\s*P/gu)].map(match => `${Number(match[1])}P`))];
}

export function parseResolutionPrices(value) {
  const text = String(value || "").replace(/\s+/gu, " ");
  const prices = {};
  const matcher = new RegExp(`((?:\\d{3,4}\\s*P)(?:\\s*[/／]\\s*\\d{3,4}\\s*P)*)\\s*(${NUMBER})\\s*元\\s*[/／]\\s*(秒|次)`, "giu");
  for (const match of text.matchAll(matcher)) {
    const amount = Number(match[2]);
    const unit = match[3] === "秒" ? "per_second" : "per_generation";
    for (const resolution of parseResolutions(match[1])) prices[resolution] = { amount, unit };
  }
  return prices;
}

function fallbackPriceAmount(value) {
  const text = String(value || "").replace(/\s+/gu, " ");
  const symbolPrice = [...text.matchAll(/[¥￥]\s*(\d+(?:\.\d+)?)/gu)];
  if (symbolPrice.length) return Number(symbolPrice[0][1]);
  const unitPrice = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:元|人民币)(?=\s*(?:[/／]\s*(?:秒|次))?)/gu)];
  return unitPrice.length ? Number(unitPrice[0][1]) : null;
}

function priceAtDuration(entry, seconds, maxDuration) {
  if (!entry || !Number.isFinite(seconds) || seconds > maxDuration) return null;
  return Number((entry.amount * (entry.unit === "per_second" ? seconds : 1)).toFixed(6));
}

export function normalizePriceRow(row, { sourceHost = "old.nxrouyuan.top" } = {}) {
  const name = String(row.name || row.workflow || "").trim();
  const resolutionText = String(row.resolutions || row.resolution || "");
  const saleText = String(row.saleText || row.price || "");
  const billingText = String(row.billing || row.billingType || "");
  const maxDurationMatch = String(row.maxDuration || row.duration || "").match(/\d+/u);
  const maxDuration = Number(maxDurationMatch?.[0] || 0);
  const resolutions = parseResolutions(resolutionText);
  const pricesByResolution = parseResolutionPrices(saleText);
  // Never treat resolution labels such as 480P/720P as monetary amounts.
  // A fallback price must be explicitly attached to ¥/￥/元.
  const fallbackAmount = fallbackPriceAmount(saleText);
  const fallbackUnit = /按秒|元\s*[/／]\s*秒/u.test(`${billingText} ${saleText}`) ? "per_second" : "per_generation";
  if (!Object.keys(pricesByResolution).length && fallbackAmount != null && Number.isFinite(fallbackAmount)) {
    for (const resolution of resolutions) pricesByResolution[resolution] = { amount: fallbackAmount, unit: fallbackUnit };
  }
  const preferredResolution = pricesByResolution["720P"] ? "720P" : pricesByResolution["768P"] ? "768P" : Object.keys(pricesByResolution)[0] || "";
  const preferred = pricesByResolution[preferredResolution];
  return {
    modelName: name,
    matchKey: compactName(name),
    resolutions,
    billingType: preferred?.unit || fallbackUnit,
    pricesByResolution,
    preferredResolution,
    price15: priceAtDuration(preferred, 15, maxDuration),
    price30: priceAtDuration(preferred, 30, maxDuration),
    maxDuration,
    currency: "CNY",
    sourceHost,
    enabled: true
  };
}

export function normalizePriceRows(rows, options = {}) {
  const models = rows.map(row => normalizePriceRow(row, options)).filter(model => model.modelName && model.maxDuration && Object.keys(model.pricesByResolution).length);
  if (models.length < 5) throw new Error(`价格表仅识别到 ${models.length} 个有效模型，拒绝覆盖上一版`);
  const occurrences = new Map();
  return models.map(model => {
    const occurrence = (occurrences.get(model.matchKey) || 0) + 1;
    occurrences.set(model.matchKey, occurrence);
    return {
      ...model,
      entryKey: occurrence === 1 ? model.matchKey : `${model.matchKey}#${occurrence}`
    };
  });
}
