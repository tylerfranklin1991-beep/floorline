import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { TUTORIAL_CATEGORIES, TUTORIALS, tutorialById, tutorialsFor } from "./tutorials.ts";

test("every tutorial has a short title, 3–6 steps, and bundled media", () => {
  const ids = new Set<string>();
  for (const t of TUTORIALS) {
    assert.equal(ids.has(t.id), false, t.id);
    ids.add(t.id);
    assert.ok(t.title.length > 0 && t.title.length < 48, t.id);
    assert.ok(t.steps.length >= 3 && t.steps.length <= 6, t.id);
    assert.ok(TUTORIAL_CATEGORIES.includes(t.category), t.category);
    for (const [i, s] of t.steps.entries()) {
      assert.equal(s.image, `/tutorials/${t.id}/${i + 1}.webp`);
      assert.equal(existsSync(`public${s.image}`), true, s.image);
    }
    if (t.video) {
      assert.equal(t.video, `/tutorials/${t.id}/clip.mp4`);
      assert.equal(existsSync(`public${t.video}`), true, t.video);
    }
  }
});

test("Beta hides the ARCore topic and Beta 2 includes it", () => {
  assert.equal(tutorialsFor("beta").some((t) => t.id === "arcore"), false);
  assert.equal(tutorialById("beta2", "arcore")?.category, "ARCore scan");
  assert.ok(tutorialsFor("beta").length >= 8);
});
