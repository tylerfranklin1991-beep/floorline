import assert from "node:assert/strict";
import { test } from "node:test";
import { newProperty, newRoom, rectPoints, uid } from "./model.ts";
import {
  buildQuoteLines,
  EMPTY_RATES,
  freshQuote,
  EMPTY_BOOK,
  lineAmount,
  pricesBlank,
  quoteTotals,
  refreshLines,
  DEFAULT_LVP_BOX_SF,
} from "./quote.ts";

test("quote rates start at zero and the price list is blank", () => {
  assert.equal(pricesBlank(EMPTY_RATES), true);
  assert.equal(DEFAULT_LVP_BOX_SF, 23.77);
  const p = newProperty("Smith", "ft");
  p.address = "12 Oak St";
  p.job = { customer: "Jane Smith" };
  p.rooms = [
    { ...newRoom("Living", rectPoints(0, 0, 12, 10), "typed"), flooring: { material: "hard" } },
  ];
  const lines = buildQuoteLines(p);
  const mat = lines.find((l) => l.id.startsWith("lvp-") && !l.id.includes("labor"))!;
  assert.equal(mat.price, 0);
  assert.equal(lineAmount(mat), 0);
  assert.match(mat.label, /23\.77/);
  assert.match(mat.label, /box size not set/);
  // 120 sf × 1.10 = 132. 132 / 23.77 = 5.55 → 6 boxes → 142.62 sf.
  assert.equal(mat.qty, 142.62);
  const labor = lines.find((l) => l.id.includes("lvp-labor"))!;
  assert.equal(labor.qty, 120);
  assert.ok(lines.some((l) => l.id === "tearout" && l.qty === 120));
  assert.ok(lines.some((l) => l.id === "haul" && l.qty === 120));
  assert.ok(lines.some((l) => l.id === "poly" && l.qty === 120));
  assert.ok(lines.some((l) => l.id === "level"));
  assert.ok(lines.some((l) => l.id === "furniture" && l.qty === 1));
  const q = freshQuote(p, EMPTY_BOOK, "SCG-1001");
  assert.equal(q.customer, "Jane Smith");
  assert.equal(q.address, "12 Oak St");
  assert.equal(quoteTotals(q).total, 0);
});

test("a set box size is used, and a typed price survives a refresh", () => {
  const p = newProperty("Smith", "ft");
  p.job = { lvpBoxSqFt: 20, lvpWastePct: 0 };
  p.rooms = [
    { ...newRoom("Kitchen", rectPoints(0, 0, 10, 10), "typed"), flooring: { material: "hard" } },
  ];
  const lines = buildQuoteLines(p, { ...EMPTY_RATES, lvpPerSf: 3 });
  const mat = lines.find((l) => l.rateKey === "lvpPerSf")!;
  assert.equal(mat.qty, 100);
  assert.equal(mat.price, 3);
  assert.doesNotMatch(mat.label, /not set/);
  mat.price = 4;
  p.rooms[0].points = rectPoints(0, 0, 10, 20);
  const next = refreshLines(p, lines, EMPTY_RATES);
  const again = next.find((l) => l.rateKey === "lvpPerSf")!;
  assert.equal(again.qty, 200);
  assert.equal(again.price, 4);
  const custom = { id: "custom-1", label: "Stair nose", qty: 2, unit: "ea", price: 18, custom: true };
  const withCustom = refreshLines(p, [...next, custom], EMPTY_RATES);
  assert.equal(withCustom.filter((l) => l.custom).length, 1);
});

test("carpet quote uses the T-seam order, plus pad, and doorways become transition lines", () => {
  const p = newProperty("Smith", "ft");
  p.job = { pad: true, padWastePct: 0, trimIn: 0 };
  const room = newRoom("Bed", rectPoints(0, 0, 20, 15), "typed");
  room.flooring = { material: "carpet", trimIn: 0, quarterRound: true };
  p.rooms = [room];
  p.openings = [
    { id: uid("open"), roomId: room.id, kind: "door", wall: 0, offset: 4, width: 3, transition: "t-mold" },
  ];
  const lines = buildQuoteLines(p, { ...EMPTY_RATES, carpetPerSy: 20, transitionEach: 12, basePerLf: 2 });
  const carpet = lines.find((l) => l.id.startsWith("carpet-") && !l.id.includes("labor"))!;
  assert.equal(carpet.qty, 42.67);
  assert.match(carpet.label, /32 lin ft/);
  const labor = lines.find((l) => l.id.startsWith("carpet-labor"))!;
  assert.equal(labor.qty, 33.33);
  const pad = lines.find((l) => l.id.startsWith("pad-"))!;
  assert.equal(pad.qty, 33.4);
  const trans = lines.find((l) => l.id === "trans-t-mold")!;
  assert.equal(trans.qty, 1);
  assert.equal(trans.price, 12);
  const base = lines.find((l) => l.id === "base")!;
  assert.equal(base.qty, 67);
  const quarter = lines.find((l) => l.id === "quarter")!;
  assert.equal(quarter.qty, 67);
  const totals = quoteTotals({
    lines,
    markupPct: 10,
    taxPct: 6,
    discount: 50,
    depositPct: 50,
  });
  assert.ok(totals.subtotal > 0);
  assert.equal(totals.markup, round2(totals.subtotal * 0.1));
  assert.ok(totals.total > totals.deposit);
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
