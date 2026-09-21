import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStockChange, normalizeProduct, normalizeStock } from "../catalog.js";

test("normalizeStock: blank means untracked; numbers are whole and never negative", () => {
  assert.equal(normalizeStock(""), null);
  assert.equal(normalizeStock(undefined), null);
  assert.equal(normalizeStock(null), null);
  assert.equal(normalizeStock("abc"), null);
  assert.equal(normalizeStock("4.7"), 4);
  assert.equal(normalizeStock(-3), 0);
});

test("adding stock to a sold-out saree puts it back on sale", () => {
  const p = applyStockChange({ stock: 0, inStock: false }, { delta: 5 });
  assert.deepEqual([p.stock, p.inStock], [5, true]);
});

test("adding to an untracked saree starts from zero", () => {
  assert.equal(applyStockChange({ stock: null, inStock: true }, { delta: 3 }).stock, 3);
});

test("removing more than there is stops at zero and sells out", () => {
  const p = applyStockChange({ stock: 2, inStock: true }, { delta: -9 });
  assert.deepEqual([p.stock, p.inStock], [0, false]);
});

test("clearing the count stops tracking and keeps the admin's in-stock choice", () => {
  const p = applyStockChange({ stock: 0, inStock: false }, { stock: "" });
  assert.deepEqual([p.stock, p.inStock], [null, false]);
});

test("applyStockChange leaves the original untouched", () => {
  const original = { stock: 1, inStock: true };
  applyStockChange(original, { delta: 1 });
  assert.deepEqual(original, { stock: 1, inStock: true });
});

test("normalizeProduct keeps only non-empty string image URLs", () => {
  const p = normalizeProduct({ name: " Silk ", price: "10", images: ["a.jpg", "", 5, null] });
  assert.deepEqual([p.name, p.price, p.images], ["Silk", 10, ["a.jpg"]]);
});
