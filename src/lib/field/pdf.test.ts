import assert from "node:assert/strict";
import { test } from "node:test";
import { pickScale } from "./pdf.ts";

test("pdf: picks the largest standard scale that fits", () => {
  // 30' × 20' plan in a 7.5" × 5.6" box → 1/4" = 1' (7.5" × 5")
  assert.equal(pickScale(30, 20, 7.5, 5.6, false)[0], '1/4" = 1\'-0"');
  assert.equal(pickScale(80, 40, 7.5, 5.6, false)[0], '3/32" = 1\'-0"');
  assert.equal(pickScale(10, 8, 7.5, 5.6, true)[0], "1:75");
});
