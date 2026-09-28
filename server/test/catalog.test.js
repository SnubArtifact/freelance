import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allImages,
  applyStockChange,
  findColor,
  normalizeCategories,
  normalizeColors,
  normalizeProduct,
  normalizeStock,
} from "../catalog.js";

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

test("normalizeColors drops nameless and repeated colours and bad swatches", () => {
  assert.deepEqual(
    normalizeColors([
      { name: " Maroon ", hex: "#6D1F3A", images: ["m.jpg", ""] },
      { name: "maroon", hex: "#000000" },
      { name: "", hex: "#ffffff" },
      { name: "Teal", hex: "red" },
      "junk",
    ]),
    [
      { name: "Maroon", hex: "#6d1f3a", images: ["m.jpg"] },
      { name: "Teal", hex: "", images: [] },
    ]
  );
  assert.deepEqual(normalizeColors(undefined), []);
});

test("findColor and allImages", () => {
  const p = { images: ["a.jpg"], colors: [{ name: "Teal", images: ["t.jpg"] }] };
  assert.equal(findColor(p, " teal ").name, "Teal");
  assert.equal(findColor(p, "Pink"), null);
  assert.deepEqual(allImages(p), ["a.jpg", "t.jpg"]);
});

test("normalizeCategories: names are required and unique; renames are noted", () => {
  const { categories, renames } = normalizeCategories([
    { name: " Kanchipuram ", tagline: "Heirloom", home: 1, was: "Kanjivaram" },
    { name: "Cotton", was: "Cotton" },
    { name: "New one" },
  ]);
  assert.deepEqual(categories, [
    { name: "Kanchipuram", tagline: "Heirloom", home: true },
    { name: "Cotton", tagline: "", home: false },
    { name: "New one", tagline: "", home: false },
  ]);
  assert.deepEqual(renames, [{ from: "Kanjivaram", to: "Kanchipuram" }]);
  assert.match(normalizeCategories([{ name: "" }]).error, /needs a name/);
  assert.match(normalizeCategories([{ name: "A" }, { name: "a" }]).error, /twice/);
  assert.ok(normalizeCategories("nope").error);
});
