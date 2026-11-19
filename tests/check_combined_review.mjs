import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const [url, out, playwright = "playwright"] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const checks = [];
const check = (ok, label) => { assert(ok, label); checks.push(label); console.log("PASS", label); };
const tab = (p, id) => p.locator("#tab-" + id);
const view = (p, id) => p.frameLocator("#panel-" + id + " iframe");
const read = (frame) => frame.evaluate(() => window.reviewState());
const image = (p, name) => p.screenshot({ path: join(out, name + ".png") });

async function ready(p, id) {
  await view(p, id).locator("#loading.hidden").waitFor({ state: "attached" });
  const frame = p.frames().find(f => new URL(f.url()).pathname.endsWith("/" + id + "/index.html"));
  await frame.evaluate(async () => {
    window.reviewState = (await import("./viewer.js")).inspectLayout;
    window.reviewActive = (await import("./embedding.js")).viewActive;
  });
  await frame.waitForFunction(() => window.reviewActive() && window.reviewState().frame > 0);
  return frame;
}

await mkdir(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, reducedMotion: "reduce" });
  const errors = [], responses = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => responses.push([r.url(), r.status()]));
  check((await page.goto(url)).ok(), "Workspace responds over HTTP");
  const context = await ready(page, "context");
  check(await tab(page, "context").getAttribute("aria-selected") === "true", "Declared default opens");
  check(await page.locator("iframe").count() === 1, "Default only loads its own scene");
  check(await page.title() === "Assembly study", "Workspace applies configured title");
  check((await read(context)).motion.time === 0, "Embedded viewer respects reduced motion");
  await view(page, "context").locator("#play-motion").click();
  await context.waitForFunction(() => window.reviewState().motion.time > .08);
  check((await read(context)).motion.playing, "Context plays real animation");
  await tab(page, "motion").click();
  const motion = await ready(page, "motion");
  const parked = (await read(context)).motion.time;
  await page.waitForTimeout(180);
  check(!(await context.evaluate(() => window.reviewActive())), "Hidden context receives activity change");
  check((await read(context)).motion.time === parked, "Hidden playback clock stays frozen");
  check(await page.locator("#panel-context").evaluate(el => el.inert), "Hidden panel blocks input and focus");
  await view(page, "motion").locator("#motion-time").evaluate(el => {
    el.value = ".47"; el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  check(Math.abs((await read(motion)).motion.time - .47) < .001, "Motion tab scrubs independently");
  await image(page, "motion");
  await tab(page, "motion").focus();
  await page.keyboard.press("ArrowRight");
  const parts = await ready(page, "parts");
  const atlas = view(page, "parts");
  check(await tab(page, "parts").getAttribute("aria-selected") === "true", "Keyboard switches tabs");
  check(await atlas.locator("#explode").textContent() === "Reassemble", "Parts open exploded");
  check(await atlas.locator("#motion").isHidden(), "Static parts have no playback toolbar");
  check(await atlas.locator("#part-key").isVisible(), "Exploded parts key is visible");
  const spread = await read(parts);
  await image(page, "exploded");
  await atlas.locator("#part").selectOption("0");
  check((await read(parts)).nodes.filter(n => n.visible).length === 1, "Part selection isolates geometry");
  await atlas.locator("#structure").selectOption("0");
  check((await read(parts)).nodes.filter(n => n.visible).flatMap(n => n.children).filter(n => n.visible).length === 1,
    "Structure isolation selects one child");
  await tab(page, "context").click();
  await context.waitForFunction(t => window.reviewState().motion.time !== t, parked);
  check((await read(context)).motion.playing, "Context resumes its prior play intent");
  check(await page.locator("iframe").count() === 3, "Visited canvases are retained");
  await page.goBack();
  check(await tab(page, "parts").getAttribute("aria-selected") === "true", "Back restores the previous tab");
  check(await atlas.locator("#structure").inputValue() === "0", "Part detail state survives switching");
  await atlas.locator("#explode").click();
  const assembled = await read(parts);
  check(assembled.nodes.some((n,i) => n.position.join() !== spread.nodes[i].position.join()), "Reassembly moves parts");
  await atlas.locator("#explode").click();
  check((await read(parts)).nodes.every((n,i) => n.position.join() === spread.nodes[i].position.join()), "Re-explode restores exact offsets");
  await tab(page, "motion").click();
  check(Math.abs((await read(motion)).motion.time - .47) < .001, "Returning retains paused scrub state");
  check(!errors.length, "No uncaught browser errors");
  check(responses.every(([src]) => new URL(src).origin === new URL(url).origin), "Only same-origin runtime assets");
  check(responses.filter(([src, code]) => src.endsWith("model.glb") && code === 200).length === 3, "All three assets delivered");
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await mobile.goto(url + "#parts");
  await ready(mobile, "parts");
  check(await mobile.locator("iframe").count() === 1, "Deep link loads only the requested panel");
  check(await mobile.evaluate(() => document.documentElement.scrollWidth === innerWidth), "Switcher fits a narrow screen");
  await image(mobile, "mobile");
  await mobile.route("**/views/motion/model.glb", route => route.fulfill({ status: 404, body: "missing fixture" }));
  await tab(mobile, "motion").click();
  await view(mobile, "motion").getByText("Could not load model.glb").waitFor();
  check(true, "A missing view model reports its error");
  await tab(mobile, "parts").click();
  check(await view(mobile, "parts").locator("#part-key").isVisible(), "Other views remain usable after a load failure");

  // Import the sampler in a delivered child so the exact package is exercised.
  const trace = await mobile.frames().find(f => new URL(f.url()).pathname.endsWith("/parts/index.html")).evaluate(async () => {
    const { createPathTrace } = await import("./path-trace.js");
    const trace = createPathTrace({ interval: .25, duration: 1 });
    trace.sample(0, [0,0,0]);
    const skipped = !trace.sample(.1, [1,0,0]);
    trace.sample(1.25, [2,0,0]);
    const aged = trace.points().length === 1;
    trace.sample(0, [3,0,0]);
    const rewound = trace.points().flat().join() === "3,0,0";
    trace.clear();
    return skipped && aged && rewound && trace.points().length === 0;
  });
  check(trace, "Trace sampling, expiry, rewind and reset use scene time");
  await writeFile(join(out, "results.json"), JSON.stringify({ checks, responses }, null, 2) + "\n");
  console.log(checks.length + " browser checks passed");
} finally {
  await browser.close();
}
