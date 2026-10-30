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
const output = mkdtempSync(join(tmpdir(), "gremio-finance-plan-browser-"));

require("esbuild").buildSync({
  entryPoints: [join(__dirname, "finance-plan.fixture.tsx")], bundle: true,
  outfile: join(output, "bundle.js"), jsx: "automatic", absWorkingDir: repository,
  alias: {
    react: join(repository, "node_modules/react"),
    "react-dom": join(repository, "node_modules/react-dom"),
    "@/app/intern/board/actions": join(__dirname, "board-views.actions.fixture.ts"),
    "next/navigation": join(__dirname, "board-views.navigation.fixture.ts"),
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
      assert.equal(await page.locator("input[name=title]").count(), 0, "no editable fields before confirmation");
      await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await page.waitForFunction(() => location.hash === "#/finanzen/42");
      assert.equal(await page.locator("input[name=title]").count(), 0);
      await page.reload();
      await page.getByRole("button", { name: "Ja, bearbeiten", exact: true }).click();
      assert.equal(await page.getByRole("dialog").count(), 0);
      const title = page.locator("input[name=title]");
      await title.fill("Aktualisierte Position");
      await page.getByRole("status").filter({ hasText: "Änderungen werden automatisch gespeichert" }).waitFor();
      await title.press("Tab");
      await page.getByRole("status").filter({ hasText: "Wird gespeichert" }).waitFor();
      await page.getByRole("status").filter({ hasText: "Automatisch gespeichert" }).waitFor();
      assert.equal(await page.evaluate(() => window.savedPlans.at(-1).title), "Aktualisierte Position");
      await page.evaluate(() => { window.failNextSave = true; });
      await title.fill("Entwurf bleibt erhalten");
      await title.press("Tab");
      await page.getByRole("status").filter({ hasText: "Speichern fehlgeschlagen" }).waitFor();
      assert.equal(await title.inputValue(), "Entwurf bleibt erhalten");
      await page.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Automatisch gespeichert" }).waitFor();
      assert.equal(await page.evaluate(() => window.savedPlans.at(-1).title), "Entwurf bleibt erhalten");
      await page.screenshot({ path: join(output, `finance-plan-${width}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close(); await new Promise(resolveClose => server.close(resolveClose));
    console.log(`Browser artifacts: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
