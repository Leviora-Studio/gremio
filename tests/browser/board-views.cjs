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
const output = mkdtempSync(join(tmpdir(), "gremio-board-views-browser-"));

require("esbuild").buildSync({
  entryPoints: [join(__dirname, "board-views.fixture.tsx")], bundle: true,
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
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const view = name => page.getByRole("group", { name: "Board-Ansicht" }).getByRole("button", { name, exact: true });
      const search = page.getByPlaceholder("Alle Felder durchsuchen …");
      await view("Liste").click();
      await page.getByRole("button", { name: "Alle zuklappen" }).click();
      assert.equal(await page.getByRole("link", { name: "Sommerfest", exact: true }).isVisible(), false);
      await page.getByRole("button", { name: "Eingegangen 2" }).click();
      assert.equal(await page.getByRole("link", { name: "Sommerfest", exact: true }).isVisible(), true);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('[aria-label="Board-Ansicht"] button[aria-pressed="true"]')?.textContent === "Liste");
      assert.equal(await page.getByRole("button", { name: "Angenommen 1" }).getAttribute("aria-expanded"), "false");
      await page.getByText("Gruppen auswählen", { exact: true }).click();
      await page.getByRole("checkbox", { name: "Gruppe Eingegangen anzeigen", exact: true }).uncheck();
      assert.equal(await page.getByRole("button", { name: "Eingegangen 2", exact: true }).count(), 0);
      assert.equal(await page.getByRole("region", { name: "Ausgeblendete Gruppen", exact: true }).getByRole("button", { name: "Eingegangen einblenden", exact: true }).count(), 1);
      await page.reload();
      await page.getByRole("button", { name: "Eingegangen einblenden", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Eingegangen 2", exact: true }).count(), 0);
      await search.fill("Sommerfest");
      await page.getByRole("link", { name: "Sommerfest", exact: true }).waitFor({ state: "visible" });
      await page.getByText("Durch Suche/Filter eingeblendet", { exact: true }).waitFor();
      await search.fill("");
      assert.equal(await page.getByRole("button", { name: "Eingegangen 2", exact: true }).count(), 0);
      await page.getByRole("button", { name: "Eingegangen einblenden", exact: true }).click();
      await page.getByRole("button", { name: "Eingegangen 2", exact: true }).waitFor();
      await search.fill("Sommerfest");
      await view("Tabelle").click();
      assert.equal(await search.inputValue(), "Sommerfest");
      assert.equal(await page.locator("tbody tr").count(), 1);
      await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
      assert.equal(await page.locator("tbody tr").count(), 3);
      await page.getByRole("button", { name: "Genehmigter Betrag (€)", exact: true }).click();
      assert.deepEqual(await page.locator("tbody tr td:first-child a").allTextContents(), ["Sommerfest", "Materialkosten", "Ohne Termin"]);
      await page.getByRole("button", { name: "Genehmigter Betrag (€) ↑", exact: true }).click();
      assert.deepEqual(await page.locator("tbody tr td:first-child a").allTextContents(), ["Materialkosten", "Sommerfest", "Ohne Termin"]);
      await page.getByText("Tabellenspalten auswählen", { exact: true }).click();
      await page.getByRole("checkbox", { name: "Antragsteller", exact: true }).uncheck();
      assert.equal(await page.getByRole("columnheader", { name: "Antragsteller", exact: true }).count(), 0);
      await page.getByRole("button", { name: "Status für Sommerfest", exact: true }).click();
      await page.getByRole("option", { name: "Angenommen", exact: true }).click();
      await page.waitForFunction(() => window.lastMove?.statusId === 20);
      assert.equal(await page.getByRole("button", { name: "Status für Sommerfest", exact: true }).textContent().then(t => t.includes("Angenommen")), true);
      await page.screenshot({ path: join(output, `table-${width}.png`), fullPage: true });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('[aria-label="Board-Ansicht"] button[aria-pressed="true"]')?.textContent === "Tabelle");
      assert.equal(await page.getByRole("columnheader", { name: "Antragsteller", exact: true }).count(), 0);
      await page.getByText("Tabellenspalten auswählen", { exact: true }).click();
      await page.getByRole("button", { name: "Titel verschieben", exact: true }).scrollIntoViewIfNeeded();
      await page.locator("table").evaluate(table => { table.parentElement.scrollLeft = 0; });
      const dragSource = await page.getByRole("button", { name: "Titel verschieben", exact: true }).boundingBox();
      const dragTarget = await page.getByRole("button", { name: "Status verschieben", exact: true }).boundingBox();
      assert.ok(dragSource && dragTarget);
      await page.mouse.move(dragSource.x + dragSource.width / 2, dragSource.y + dragSource.height / 2);
      await page.mouse.down();
      await page.mouse.move(dragSource.x + dragSource.width / 2 + 10, dragSource.y + dragSource.height / 2);
      await page.mouse.move(dragTarget.x + dragTarget.width / 2, dragTarget.y + dragTarget.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.waitForFunction(() => document.querySelector("thead th")?.textContent === "Status");
      assert.equal(await page.locator("thead th").first().textContent(), "Status");
      assert.equal(await page.locator("tbody tr").first().locator("td").nth(1).locator("a").count(), 1);
      await search.fill("Sommerfest");
      await page.waitForFunction(() => {
        const header = document.querySelector('[data-column-key="title"]');
        const viewport = document.querySelector("table").parentElement;
        return header.getBoundingClientRect().left >= viewport.getBoundingClientRect().left - 2 && header.getBoundingClientRect().left < viewport.getBoundingClientRect().right;
      });
      await page.reload();
      await page.waitForFunction(() => document.querySelector("thead th")?.textContent === "Status");
      await page.getByText("Tabellenspalten auswählen", { exact: true }).click();
      await page.getByRole("button", { name: "Reihenfolge zurücksetzen", exact: true }).click();
      assert.equal(await page.locator("thead th").first().textContent(), "Titel ↑");
      const optionHandle = page.getByRole("button", { name: "Titel in Spaltenauswahl verschieben", exact: true });
      await optionHandle.focus();
      await page.keyboard.press("Space");
      await page.waitForFunction(() => document.querySelector('[aria-label="Titel in Spaltenauswahl verschieben"]')?.getAttribute("aria-pressed") === "true");
      await page.waitForTimeout(100);
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(100);
      await page.keyboard.press("Space");
      await page.waitForFunction(() => document.querySelector("thead th")?.textContent === "Status");
      await page.getByRole("button", { name: "Reihenfolge zurücksetzen", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: /nach (links|rechts)$/ }).count(), 0);
      await view("Kalender").click();
      assert.equal(await page.getByRole("heading", { name: "Ohne Frist · 1" }).count(), 1);
      await page.screenshot({ path: join(output, `calendar-month-${width}.png`), fullPage: true });
      if (width >= 640) await page.getByRole("button", { name: "Terminliste", exact: true }).click();
      assert.equal(await page.getByRole("link", { name: "Sommerfest", exact: true }).count(), 1); // Only the visible calendar layout is accessible
      await page.getByRole("button", { name: "Nächster Monat", exact: true }).click();
      assert.equal(await page.getByText("Keine Termine in diesem Monat.", { exact: true }).isVisible(), true);
      await page.getByRole("button", { name: "Heute", exact: true }).click();
      await page.getByRole("button", { name: "Kalenderdatum", exact: true }).click();
      await page.getByRole("option", { name: "Sitzungen", exact: true }).click();
      assert.equal(await page.getByRole("heading", { name: "Ohne Sitzungsdatum · 2" }).count(), 1);
      await page.screenshot({ path: join(output, `calendar-${width}.png`), fullPage: true });
      await view("Liste").click();
      await page.getByRole("button", { name: "Alle aufklappen" }).click();
      await page.screenshot({ path: join(output, `list-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Alle", exact: true }).first().click();
      await page.getByRole("option", { name: "Anna", exact: true }).click();
      await view("Tabelle").click();
      assert.equal(await page.locator("tbody tr").count(), 1);
      await view("Kalender").click();
      assert.equal(await page.getByRole("link", { name: "Materialkosten", exact: true }).count(), 0);
      await view("Kanban").click();
      assert.equal(await page.getByText("Materialkosten", { exact: true }).count(), 0);
      await page.getByRole("button", { name: "Zurücksetzen", exact: true }).click();
      await search.fill("keine treffer");
      await view("Tabelle").click();
      assert.equal(await page.getByText("Keine Karten für die aktuelle Auswahl.").isVisible(), true);
      await page.goto(`${url}?restricted`);
      await view("Tabelle").click();
      assert.deepEqual(await page.locator("thead th").allTextContents(), ["Titel ↑", "Status", "Antragsnummer"]);
      await view("Kalender").click();
      assert.equal(await page.getByText(/Für den Kalender muss das Feld/).isVisible(), true);
      await page.goto(url);
      await view("Liste").click();
      await page.getByRole("button", { name: "Alle aufklappen" }).click();
      await page.getByRole("button", { name: "Status für Materialkosten", exact: true }).click();
      await page.getByRole("option", { name: "Angenommen", exact: true }).click();
      await page.waitForFunction(() => window.lastMove?.cardId === 2);
      await page.getByRole("button", { name: "Angenommen 2", exact: true }).waitFor();
      assert.equal(await page.getByRole("link", { name: "Materialkosten", exact: true }).getAttribute("href"), "/intern/card/2");
      if (width === 1200) {
        await page.addStyleTag({ content: 'html { font-size: 200%; }' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: join(output, 'list-text200.png'), fullPage: true });
      }
      await page.goto(`${url}?search-navigation`);
      await view("Kanban").click();
      await search.fill("Ohne Termin");
      await page.waitForFunction(() => {
        const viewport = document.querySelector('[aria-label="Kanban-Spalten"]');
        const column = viewport.querySelector('[data-status-id="20"]');
        const bounds = viewport.getBoundingClientRect(), target = column.getBoundingClientRect();
        return target.left >= bounds.left - 2 && target.right <= bounds.right + 2;
      });
      assert.equal(await search.evaluate(node => document.activeElement === node), true);
      await search.fill("");
      await view("Liste").click();
      await page.getByRole("button", { name: "Alle zuklappen" }).click();
      await search.fill("Ohne Termin");
      await page.getByRole("link", { name: "Ohne Termin", exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.getByRole("button", { name: /Vorherige Spalte/ }).count(), 0);
      await search.fill("");
      assert.equal(await page.getByRole("button", { name: "Angenommen 1", exact: true }).getAttribute("aria-expanded"), "false");
      await view("Tabelle").click();
      await page.locator("table").evaluate(table => { table.parentElement.scrollLeft = 10000; });
      await search.fill("Sommerfest");
      await page.waitForFunction(() => document.querySelector("table").parentElement.scrollLeft === 0);
      await view("Kalender").click();
      await page.getByRole("heading", { name: "März 2031", exact: true }).waitFor();
      assert.equal(await page.getByRole("link", { name: "Sommerfest", exact: true }).isVisible(), true);
      await page.getByRole("button", { name: "Nächster Monat", exact: true }).click();
      await page.getByRole("heading", { name: "April 2031", exact: true }).waitFor();
      await search.fill("Ohne Termin");
      await page.getByRole("link", { name: "Ohne Termin", exact: true }).waitFor({ state: "visible" });
      if (width >= 640) assert.equal(await page.getByText("Mo", { exact: true }).isVisible(), false);
      assert.equal(await search.evaluate(node => document.activeElement === node), true);
      await search.fill("kein treffer");
      await view("Kanban").click();
      await page.getByRole("status").filter({ hasText: "Keine Karten für die aktuelle Auswahl." }).waitFor();
      await page.goto(`${url}?office`);
      await view("Liste").click();
      await page.getByRole("button", { name: "Alle aufklappen", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Status für Ohne Termin", exact: true }).count(), 0);
      await page.getByRole("button", { name: "Status für Sommerfest", exact: true }).click();
      assert.equal(await page.getByRole("option", { name: "Leer", exact: true }).count(), 0);
      await page.getByRole("option", { name: "Angenommen", exact: true }).click();
      await page.waitForFunction(() => window.lastMove?.cardId === 1 && window.lastMove?.statusId === 20);
      await page.waitForFunction(() => !document.querySelector('[aria-label="Status für Sommerfest"]'));
      await view("Kanban").click();
      assert.equal(await page.getByText("Sommerfest", { exact: true }).locator("..").locator("..").getAttribute("aria-disabled"), "true");
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close(); await new Promise(resolveClose => server.close(resolveClose));
    console.log(`Browser artifacts: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
