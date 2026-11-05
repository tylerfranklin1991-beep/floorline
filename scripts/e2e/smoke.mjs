/* eslint-disable @typescript-eslint/no-unused-expressions */
// Phone-size end-to-end smoke test against a built app (default: dist/client served on :8090).
// Usage: node scripts/e2e/smoke.mjs [url]
import { chromium } from "playwright";
const url = process.argv[2] || "http://localhost:8090/";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
const pg = await ctx.newPage();
const errors = [];
pg.on("pageerror", (e) => errors.push(e.message));
pg.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const step = (s) => console.log("✓", s);
const fail = (s) => { console.log("✗", s); process.exitCode = 1; };
await pg.goto(url);
await pg.getByText("Start property").waitFor();
await pg.getByPlaceholder(/Property|name/i).first().fill("Smith job").catch(() => {});
await pg.getByText("Start property").click();
await pg.getByRole("button", { name: "Add room" }).waitFor();
step("job created");

// Job settings
await pg.getByRole("button", { name: "Job settings" }).click();
await pg.getByLabel("Customer").fill("Jane Smith");
await pg.getByLabel("Customer").blur();
await pg.getByLabel("Sq ft per box").fill("23.64");
await pg.getByLabel("Sq ft per box").blur();
await pg.getByLabel("Waste % (job)").fill("8");
await pg.getByLabel("Waste % (job)").blur();
await pg.getByRole("button", { name: "Close job settings" }).click();
step("job settings saved");

// LVP rectangle, typed exactly 12'7" x 10'
await pg.getByRole("button", { name: "Add room" }).click();
await pg.getByLabel("What room is it?").fill("Kitchen");
await pg.getByLabel("Width", { exact: true }).fill("12'7\"");
await pg.getByLabel("Length", { exact: true }).fill("10");
await pg.getByRole("button", { name: "Add Kitchen" }).click();
await pg.getByLabel("Wall 1 length").waitFor();
const w1 = await pg.getByLabel("Wall 1 length").inputValue();
w1.includes("12'-7") ? step(`typed size kept exact (${w1})`) : fail(`wall 1 = ${w1}`);
(await pg.getByTestId("room-lvp").innerText()).includes("boxes") ? step("LVP box count shown") : fail("no LVP boxes");
// exclusion
await pg.getByRole("button", { name: "− Island" }).click();
await pg.getByLabel("Area width").fill("6");
await pg.getByLabel("Area length").fill("3");
await pg.getByRole("button", { name: "Add area" }).click();
(await pg.getByTestId("areas-section").innerText()).includes("Island") ? step("island excluded") : fail("exclusion");
await pg.getByLabel("Room notes").fill("Glue down near slider, check subfloor");
await pg.getByRole("button", { name: "Duplicate room" }).click();
step("room duplicated");
await pg.getByRole("button", { name: "Close room panel" }).click();

// Carpet L-shape
await pg.getByRole("button", { name: "Add room" }).click();
await pg.getByLabel("What room is it?").fill("Living");
await pg.getByRole("radio", { name: "L-shape" }).click();
await pg.getByLabel("Width", { exact: true }).fill("20");
await pg.getByLabel("Length", { exact: true }).fill("18");
await pg.getByLabel("Cut-out width").fill("6");
await pg.getByLabel("Cut-out length").fill("5");
await pg.getByRole("button", { name: "Add Living" }).click();
await pg.getByRole("radio", { name: "Carpet" }).click();
await pg.getByTestId("seam-controls").waitFor();
const before = await pg.getByTestId("room-cuts").innerText();
await pg.getByRole("button", { name: "Centre seams" }).click();
const after = await pg.getByTestId("room-cuts").innerText();
before !== after ? step("seam centred, cuts changed") : fail("seam offset had no effect");
await pg.getByRole("button", { name: "Close room panel" }).click();

// Stairs: tap Stairs, tap an empty spot, type 13 steps
await pg.getByRole("button", { name: "Stairs" }).click();
await pg.mouse.click(80, 650);
try {
  await pg.getByLabel("Number of steps").waitFor({ timeout: 4000 });
  await pg.getByLabel("Number of steps").fill("13");
  await pg.getByLabel("Number of steps").blur();
  const cut = await pg.getByTestId("stair-cut").innerText();
  /13 cuts/.test(cut) ? step(`stair carpet: ${cut.slice(0, 90)}…`) : fail("stair cut");
  await pg.getByRole("button", { name: "Waterfall" }).click();
  (await pg.getByTestId("stair-cut").innerText()).includes("2\" wrap") ? step("waterfall switch") : fail("waterfall");
  await pg.getByRole("button", { name: "Close stairs panel" }).click();
} catch (e) {
  fail("stairs panel didn't open: " + e.message.split("\n")[0]);
}

// Materials
await pg.getByLabel("Open materials summary").click();
const order = await pg.getByTestId("order-list").innerText();
console.log(order.split("\n").slice(0, 14).join(" | "));
/LVP/.test(order) && /boxes/.test(order) ? step("order: LVP boxes") : fail("order LVP");
/Carpet 12' roll/.test(order) ? step("order: carpet 12'") : fail("order carpet");
/Pad/.test(order) ? step("order: pad") : fail("order pad");
/Stairs.*13 steps/s.test(order) ? step("order: stairs") : fail("order stairs");
await pg.getByRole("button", { name: "Copy as text" }).click();
const clip = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => "");
clip.includes("Jane Smith") ? step("copied text has customer") : fail("clipboard");
const csvDl = pg.waitForEvent("download");
await pg.getByRole("button", { name: "Save CSV" }).click();
console.log("  csv:", (await csvDl).suggestedFilename());
const pdfDl = pg.waitForEvent("download", { timeout: 30000 });
await pg.getByRole("button", { name: /PDF/ }).first().click();
const pdf = await pdfDl;
await pdf.saveAs("/tmp/smoke.pdf");
step(`PDF downloaded (${pdf.suggestedFilename()})`);

// Persistence across restart
await pg.reload();
await pg.waitForTimeout(1500);
const body = await pg.innerText("body");
body.includes("Kitchen") || body.includes("Smith job") ? step("data survived reload") : fail("data lost on reload");
const saved = await pg.evaluate(() => localStorage.getItem("floorline-field-v1"));
saved.includes("Jane Smith") && saved.includes("Island") && saved.includes("Glue down") ? step("customer, exclusions, notes persisted") : fail("persist fields");
const hyd = errors.filter((e) => /418|hydrat/i.test(e));
hyd.length ? fail(`hydration errors: ${hyd[0]}`) : step("no hydration (#418) errors");
if (errors.length) console.log("page errors:", errors.slice(0, 5));
await pg.screenshot({ path: "/tmp/smoke.png" });
await b.close();
