import { test } from "node:test";
import assert from "node:assert/strict";
import { feedbackBody, feedbackSubject, mailtoUrl } from "./feedback.ts";
import { canCreateJob, entitled, FREE_JOB_LIMIT } from "./pro.ts";

test("feedback subject/body carry category and version", () => {
  assert.match(feedbackSubject("Feature suggestion"), /\[Floorline .+\] Feature suggestion/);
  const b = feedbackBody("Other", "  hello  ", "UA");
  assert.ok(b.startsWith("hello\n"));
  assert.match(b, /Category: Other/);
  assert.match(b, /Device: UA/);
});

test("mailto encodes subject and body", () => {
  const u = mailtoUrl("a@b.c", "x & y", "line1\nline2");
  assert.equal(u, "mailto:a@b.c?subject=x%20%26%20y&body=line1%0Aline2");
});

test("billing flag off = everything unlocked", () => {
  assert.equal(entitled([], false), true);
  assert.equal(entitled([], true), false);
  assert.equal(entitled(["floorline_pro_yearly"], true), true);
  assert.equal(entitled(["something_else"], true), false);
  assert.equal(canCreateJob(FREE_JOB_LIMIT - 1, false), true);
  assert.equal(canCreateJob(FREE_JOB_LIMIT, false), false);
  assert.equal(canCreateJob(99, true), true);
});

test("tester promo product grants Pro", () => {
  assert.equal(entitled(["floorline_pro_tester"], true), true);
});
