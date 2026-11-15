import test from "node:test";
import assert from "node:assert/strict";
import { normalizePriceRow, normalizePriceRows, parseResolutionPrices } from "../src/normalize.mjs";

test("解析按秒且计算15秒价格", () => {
  const model = normalizePriceRow({
    name: "minimax H3", resolutions: "480P / 720P / 768P", billing: "按秒",
    saleText: "480P 0.06 元/秒 720P / 768P 0.06 元/秒 例：10 秒 480P = 0.6 元", maxDuration: "15 秒"
  });
  assert.equal(model.preferredResolution, "720P");
  assert.equal(model.price15, 0.9);
  assert.equal(model.price30, null);
});

test("按画质解析不同固定价格", () => {
  const prices = parseResolutionPrices("480P 2.5 元/次 720P / 768P 3.5 元/次");
  assert.equal(prices["480P"].amount, 2.5);
  assert.equal(prices["720P"].amount, 3.5);
  assert.equal(prices["768P"].amount, 3.5);
});

test("720P固定价格用于15秒和30秒", () => {
  const model = normalizePriceRow({
    name: "H sd-2.5-flash", resolutions: "480P / 720P / 768P", billing: "按次",
    saleText: "480P 2.5 元/次 720P / 768P 3.5 元/次", maxDuration: "30 秒"
  });
  assert.equal(model.price15, 3.5);
  assert.equal(model.price30, 3.5);
});

test("明显不完整的价格表不会覆盖旧版", () => {
  assert.throws(() => normalizePriceRows([{ name: "only", resolutions: "720P", billing: "按次", saleText: "720P 1 元/次", maxDuration: "15 秒" }]), /拒绝覆盖/u);
});

test("同名工作流会保留并分配唯一条目编号", () => {
  const row = (name, price = 1) => ({
    name, resolutions: "720P", billing: "按次", saleText: `720P ${price} 元/次`, maxDuration: "30 秒"
  });
  const models = normalizePriceRows([
    row("Seedance 2.5 Flash", 2.7),
    row("Seedance 2.5 Flash", 3.5),
    row("Seedance 2.0", 2.5),
    row("Msd2.0 fast", 2.3),
    row("minimax H3", 0.06)
  ]);
  assert.equal(models.length, 5);
  assert.equal(models[0].entryKey, "seedance25flash");
  assert.equal(models[1].entryKey, "seedance25flash#2");
  assert.equal(models[0].matchKey, models[1].matchKey);
});
