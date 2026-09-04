// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { mkdtempSync, writeFileSync, readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const repository = resolve(__dirname, "../..");
const output = mkdtempSync(join(tmpdir(), "gremio-home-dashboard-browser-"));

require("esbuild").buildSync({
  entryPoints: [join(__dirname, "home-dashboard.fixture.tsx")], bundle: true,
  outfile: join(output, "bundle.js"), jsx: "automatic", absWorkingDir: repository,
  alias: {
    react: join(repository, "node_modules/react"),
    "react-dom": join(repository, "node_modules/react-dom"),
    "@/app/intern/aufgaben/actions": join(__dirname, "home-dashboard.actions.fixture.ts"),
  },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
});
execFileSync(process.execPath, [require.resolve("tailwindcss/lib/cli"), "-i", "app/globals.css", "-o", join(output, "styles.css")], { cwd: repository });
writeFileSync(join(output, "index.html"), '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><body><main class="mx-auto max-w-6xl p-4"><div id="root"></div></main><script src="bundle.js"></script></body></html>');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  const server = createServer((request, response) => {
    const name = new URL(request.url, "http://localhost").pathname === "/" ? "index.html" : new URL(request.url, "http://localhost").pathname.slice(1);
    if (!["index.html", "styles.css", "bundle.js"].includes(name)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "text/html" });
    response.end(readFileSync(join(output, name)));
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    for (const width of [1200, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url);
      const order = () => page.locator("[data-home-section]").evaluateAll(nodes => nodes.map(node => node.dataset.homeSection));
      assert.deepEqual(await order(), ["tasks", "boards", "protocols", "finances", "inventories"]);
      await page.getByRole("button", { name: /Startseite anpassen/ }).click();
      for (const label of ["Meine Aufgaben", "Boards", "Protokollbereiche", "Finanzübersichten", "Inventare"]) {
        assert.equal(await page.getByRole("checkbox", { name: label, exact: true }).isChecked(), true);
        assert.equal(await page.getByRole("button", { name: `${label} verschieben`, exact: true }).count(), 1);
      }
      assert.equal(await page.getByRole("button", { name: / nach (oben|unten)$/ }).count(), 0);
      const source = await page.getByRole("button", { name: "Protokollbereiche verschieben", exact: true }).boundingBox();
      const target = await page.getByRole("button", { name: "Meine Aufgaben verschieben", exact: true }).boundingBox();
      assert.ok(source && target);
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 - 10, { steps: 2 });
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
      await page.mouse.up();
      assert.deepEqual(await order(), ["protocols", "tasks", "boards", "finances", "inventories"]);
      await page.waitForTimeout(100);
      await page.getByRole("checkbox", { name: "Inventare", exact: true }).uncheck();
      await page.waitForFunction(() => !document.querySelector('[data-home-section="inventories"]'));
      assert.deepEqual(await order(), ["protocols", "tasks", "boards", "finances"]);
      await page.waitForFunction(() => window.savedHomePrefs.at(-1)?.home?.inventories === false);
      const saved = await page.evaluate(() => window.savedHomePrefs.at(-1).home);
      assert.deepEqual(saved.order, ["protocols", "tasks", "boards", "finances", "inventories"]);
      assert.equal(saved.inventories, false);
      await page.screenshot({ path: join(output, `home-${width}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close(); await new Promise(resolveClose => server.close(resolveClose));
    console.log(`Browser artifacts: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
