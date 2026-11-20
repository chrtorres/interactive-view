import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const [base, output, playwright = "playwright", koiURL] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(playwright);
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const checks = [];
const check = (condition, label) => { assert(condition, label); checks.push(label); console.log("PASS", label); };
const near = (expected, actual, epsilon = .0001) => expected.every((n, i) => Math.abs(n - actual[i]) < epsilon);
const motion = (page) => page.evaluate(() => window.readReview());
const settle = (page, before) => page.waitForFunction((frame) => window.readReview().frame > frame, before);

async function open(path, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1160, height: 840 }, ...options });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const urls = [];
  page.on("response", (response) => urls.push([new URL(response.url()), response.status()]));
  await page.goto(path);
  await page.locator("#loading.hidden").waitFor({ state: "attached", timeout: 45_000 });
  await page.evaluate(async () => { window.readReview = (await import("./viewer.js")).inspectLayout; });
  const before = (await motion(page)).frame;
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await settle(page, before);
  check(!errors.length, "No uncaught errors loading " + new URL(path).pathname);
  check(urls.every(([url]) => url.origin === new URL(path).origin), "Viewer dependencies are local");
  check(["model.glb", "metadata.json", "motion.js"].every((file) =>
    urls.some(([url, status]) => url.pathname.endsWith("/" + file) && status === 200)), "Model, metadata and motion return HTTP 200");
  return page;
}

async function seek(page, time) {
  const { frame } = await motion(page);
  await page.locator("#motion-time").evaluate((slider, value) => {
    slider.value = String(value);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, time);
  await settle(page, frame);
  return motion(page);
}
const hinge = (sample) => sample.nodes.find(({ name }) => name === "Hinge");
const screenshot = (page, label) => page.locator("#viewer").screenshot({ path: join(output, label + ".png") });

await mkdir(output, { recursive: true });
try {
  const rigid = await open(new URL("articulated/", base).href);
  check(await rigid.locator("#motion").isVisible(), "Clip controls appear automatically");
  check(await rigid.locator("#clip option").allTextContents().then((labels) =>
    labels.join(",") === "Open panel,Repeat swing"), "Metadata renames clips for display");
  check(await rigid.locator("#play-motion").textContent() === "Play", "Viewer starts paused by default");
  check(await rigid.locator("#motion-follow-label").isVisible(), "Named moving node enables follow");
  const begin = await seek(rigid, 0);
  const startImage = await screenshot(rigid, "hinge-start");
  const end = await seek(rigid, 2);
  check(near(hinge(end).position, [0, 0, -.3]), "Scrub reaches exact final keyed position");
  check(!(await screenshot(rigid, "hinge-end")).equals(startImage), "Scrub changes rendered pixels");
  check(end.motion.time === 2 && !end.motion.playing, "Seek stops on the inclusive endpoint");
  check((await rigid.locator("#motion-time").getAttribute("aria-valuetext")).startsWith("2.00"), "Timeline exposes the exact pose to assistive technology");

  await rigid.locator("#motion-follow").check();
  const followingEnd = await motion(rigid);
  const followingStart = await seek(rigid, 0);
  const shift = followingStart.camera.map((v, i) => v - followingEnd.camera[i]);
  check(near(shift, [0, 0, .3]), "Camera follows evaluated world translation during scrubbing");
  await rigid.locator("#motion-follow").uncheck();
  const still = await seek(rigid, 1.2);
  check(near(still.camera, followingStart.camera), "Camera stays fixed with follow disabled");

  await rigid.locator("#explode").click();
  await rigid.waitForFunction(() => !window.readReview().moving);
  let split = await motion(rigid);
  check(split.motion.suspended && await rigid.locator("#play-motion").isDisabled(), "Explode suspends animation controls");
  check(near(hinge(split).position, [.6, 0, 0]), "Explode owns the rest-position offset");
  await rigid.locator("#explode").click();
  await rigid.waitForFunction(() => !window.readReview().motion.suspended && !window.readReview().moving);
  const assembled = await motion(rigid);
  check(!assembled.motion.playing && assembled.motion.time === 1.2, "Reassembly restores the paused pose time");
  check(near(hinge(assembled).position, hinge(still).position), "Reassembly restores the evaluated transform");

  await seek(rigid, 1.87);
  await rigid.locator("#play-motion").click();
  await rigid.waitForFunction(() => !window.readReview().motion.playing && window.readReview().motion.time === 2);
  check(true, "One-shot playback finishes at the last key");
  await rigid.selectOption("#clip", "1");
  check((await motion(rigid)).motion.clip === "Oscillate" && near(hinge(await motion(rigid)).position, hinge(begin).position),
    "Clip switch clears the previous action and evaluates the new first key");
  await rigid.locator("#motion-loop").check();
  await rigid.selectOption("#motion-speed", "2");
  await seek(rigid, 1.82);
  await rigid.locator("#play-motion").click();
  await rigid.waitForFunction(() => window.readReview().motion.playing && window.readReview().motion.time < 1);
  check(true, "Loop wraps a running clip");
  await rigid.locator("#play-motion").click();
  const stopped = await motion(rigid);
  await rigid.waitForTimeout(150);
  check((await motion(rigid)).motion.time === stopped.motion.time, "Pause holds animation time");
  await rigid.locator("#motion-time").focus();
  await rigid.keyboard.press("End");
  check((await motion(rigid)).motion.time === 2, "Keyboard scrubs to clip endpoint");
  await rigid.close();

  const soft = await open(new URL("flexible/", base).href, {
    viewport: { width: 390, height: 820 }, isMobile: true, hasTouch: true, reducedMotion: "reduce",
  });
  check(!(await motion(soft)).motion.playing, "Reduced-motion preference blocks configured autoplay");
  check(await soft.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Animation toolbar fits a narrow screen");
  await soft.locator("#motion-follow").check();
  const undeformed = await screenshot(soft, "skin-first");
  await seek(soft, .47);
  check(!(await screenshot(soft, "skin-second")).equals(undeformed), "Skinned clip renders a different pose on mobile");
  await soft.screenshot({ path: join(output, "mobile.png"), fullPage: true });
  await soft.close();

  const autoplay = await open(new URL("flexible/", base).href);
  await autoplay.waitForFunction(() => window.readReview().motion.time > .05);
  check((await motion(autoplay)).motion.playing, "Configured autoplay advances a real clip");
  await autoplay.emulateMedia({ reducedMotion: "reduce" });
  await autoplay.waitForFunction(() => !window.readReview().motion.playing);
  check(true, "Changing reduced-motion preference stops autoplay");

  const upload = {
    name: "local-motion.glb", mimeType: "model/gltf-binary",
    buffer: await (await autoplay.request.get(new URL("flexible/model.glb", base).href)).body(),
  };
  await autoplay.locator("#model-file").setInputFiles(upload);
  await autoplay.getByText("Opened local-motion.glb", { exact: true }).waitFor();
  check(!(await motion(autoplay)).motion.playing, "Imported clips respect reduced motion");
  await autoplay.locator("#play-motion").click();
  await autoplay.waitForFunction(() => window.readReview().motion.time > .05);
  await autoplay.emulateMedia({ reducedMotion: "no-preference" });
  await autoplay.locator("#model-file").setInputFiles({ ...upload, name: "local-autoplay.glb" });
  await autoplay.getByText("Opened local-autoplay.glb", { exact: true }).waitFor();
  await autoplay.waitForFunction(() => window.readReview().motion.time > .05);
  check((await motion(autoplay)).motion.playing && await autoplay.locator("#motion-loop").isChecked(),
    "Imported clips start playing with loop enabled");
  await autoplay.close();

  if (koiURL) {
    const koi = await open(koiURL, { reducedMotion: "reduce" });
    check(await koi.locator("#clip option").count() === 4, "The original skinned export exposes all four motion clips");
    const first = await screenshot(koi, "original-first");
    await koi.locator("#motion-follow").check();
    let authored = await seek(koi, .35);
    check(!(await screenshot(koi, "original-second")).equals(first), "The original skinned export changes rendered pose");
    authored = await seek(koi, 6);
    check(authored.motion.time === 6 && authored.camera.every(Number.isFinite), "Follow tracks the original rig through its course");
    await koi.close();
  }
  await writeFile(join(output, "results.json"), JSON.stringify({ checks }, null, 2) + "\n");
  console.log(checks.length + " motion browser checks passed");
} finally {
  await browser.close();
}
