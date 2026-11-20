import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const [address, browserModule = "playwright", ...paths] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(browserModule);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
let checks = 0;
try {
  for (const path of paths.length ? paths : ["./"]) {
    const url = new URL(path, address);
    const modelURL = new URL("model.glb", url).href;
    const response = page.waitForResponse(modelURL);
    await page.goto(url.href);
    const link = page.getByRole("link", { name: "Download GLB" });
    await link.waitFor();
    const model = await (await response).body();
    assert.ok(model.length > 20 && model.toString("ascii", 0, 4) === "glTF");
    assert.ok(await page.locator("#viewer canvas").isVisible());
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    assert.deepEqual(await readFile(await download.path()), model);
    const local = page.locator("#model-file");
    if (await local.count()) {
      await local.setInputFiles({ name: "fixture.glb", mimeType: "model/gltf-binary", buffer: model });
      await page.waitForFunction(() => document.querySelector("#model-message").textContent === "Opened fixture.glb");
      assert.equal(await link.count(), 0);
      checks++;
    }
    checks += 3;
  }
  console.log(`${checks} geometry and download checks passed`);
} finally {
  await browser.close();
}
