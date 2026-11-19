import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { join } from "node:path";

const [url, output, browserModule="playwright", secondURL] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(browserModule);
const browser = await chromium.launch({args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const passed=[];
const check=(condition,label)=>{assert.ok(condition,label);passed.push(label);};
await mkdir(output,{recursive:true});
async function exercise(base, label) {
  const page=await browser.newPage({viewport:{width:1380,height:840},reducedMotion:"reduce"});
  const remote=[],errors=[];
  page.on("request",r=>{if (r.url().startsWith("http") && new URL(r.url()).origin!==new URL(base).origin) remote.push(r.url());});
  page.on("pageerror",e=>errors.push(e.message));
  for (const file of ["","model.glb","metadata.json","styles.css","viewer.js","vendor/build/three.core.js"]) {
    check((await page.request.head(new URL(file,base).href)).ok(),label+" HTTP "+file);
  }
  const meta=await (await page.request.get(new URL("metadata.json",base).href)).json();
  await page.goto(base);
  await page.locator("#loading.hidden").waitFor({state:"attached",timeout:60000});
  const state=()=>page.evaluate(async()=>(await import("./viewer.js")).inspectLayout());
  async function pixels(name) {
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const buf=await page.locator("#viewer").screenshot({path:join(output,label+"-"+name+".png")});
    return createHash("sha256").update(buf).digest("hex");
  }
  check(await page.locator("canvas").isVisible(),label+" canvas");
  const first=await state();
  const initial=meta.defaultMode || Object.keys(meta.modes)[0];
  const visible=geometry=>geometry.nodes.filter(node=>node.visible).map(node=>node.name).sort();
  check(JSON.stringify(visible(first))===JSON.stringify([...meta.modes[initial]].sort()),label+" default preset");
  const initialEvidence=await page.locator("#evidence").textContent();
  const assembled=await pixels("assembled");
  const alternate=Object.keys(meta.modes).find(mode=>mode!==initial);
  await page.locator("#mode").selectOption(alternate);
  check(JSON.stringify(visible(await state()))===JSON.stringify([...meta.modes[alternate]].sort()),label+" alternate preset geometry");
  check(assembled!==await pixels("alternate"),label+" alternate preset pixels");
  await page.locator("#mode").selectOption(initial);

  await page.getByRole("button",{name:"Explode",exact:true}).click();
  const separated=await state();
  check(separated.nodes.filter(node=>node.visible).length===meta.parts.length,label+" only declared parts");
  for (const part of meta.parts) {
    const matrix=separated.nodes.find(node=>node.name===part.node);
    const origin=first.nodes.find(node=>node.name===part.node);
    check(matrix.position.every((value,index)=>Math.abs(value-origin.position[index]-part.offset[index])<1e-8),
      label+" exploded offset "+part.node);
  }
  check(await page.locator("#part-labels button:visible").count()===meta.parts.length,label+" numbered callouts");
  check(await page.locator("#part-leaders line").count()===meta.parts.length,label+" leader lines");
  await page.screenshot({path:join(output,label+"-exploded.png"),fullPage:true});

  const [index,part]=[...meta.parts.entries()].find(([,entry])=>entry.sources?.length && entry.structures?.length);
  await page.locator("#part-key button").nth(index).focus();
  await page.keyboard.press("Enter");
  check(JSON.stringify(visible(await state()))===JSON.stringify([part.node]),label+" keyboard part isolation");
  check((await page.locator("#sources a").first().getAttribute("href"))===new URL(part.sources[0].url).href,
    label+" matching evidence link");
  check(await page.locator("#evidence").innerText()===part.evidence,label+" matching provenance note");
  const group=await state();
  await page.locator("#structure").selectOption("0");
  const isolated=await state();
  check(isolated.nodes.find(node=>node.name===part.node).children.filter(child=>child.visible).length===1,
    label+" exactly one child visible including unlisted children");
  check(JSON.stringify(group.camera)!==JSON.stringify(isolated.camera),label+" refit on structure");
  check(await page.locator("#selection-title").innerText()===part.structures[0].label,label+" structure label");
  await pixels("structure");
  await page.locator("#structure").selectOption("");
  check(JSON.stringify((await state()).nodes)===JSON.stringify(group.nodes),label+" all structures restored");
  await page.locator("#structure").selectOption("0");
  await page.getByRole("button",{name:"Reassemble",exact:true}).click();
  check(JSON.stringify((await state()).nodes)===JSON.stringify(first.nodes),label+" exact scene restoration after nested isolation");
  check(await page.locator("#evidence").textContent()===initialEvidence,label+" preset references restored");
  await page.setViewportSize({width:390,height:820});
  await page.getByRole("button",{name:"Explode",exact:true}).click();
  check(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),label+" narrow layout");
  await page.screenshot({path:join(output,label+"-mobile.png"),fullPage:true});
  check(!remote.length && !errors.length,label+" offline dependency closure and no browser errors");
  await page.close();
}
try {
  await exercise(url,"fixture");
  if (secondURL) await exercise(secondURL,"comparison");
  const missing=await browser.newPage();
  await missing.route("**/model.glb",route=>route.fulfill({status:404}));
  await missing.goto(url);
  await missing.getByText("Could not load model.glb").waitFor();
  check(await missing.getByText("Could not load model.glb").isVisible(),"missing model status");
} finally {
  await writeFile(join(output,"results.json"),JSON.stringify({browser:browser.version(),node:process.version,passed},null,2)+"\n");
  await browser.close();
}
console.log(`${passed.length} browser checks passed`);
