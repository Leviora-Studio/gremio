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
const output = mkdtempSync(join(tmpdir(), "gremio-result-protocol-browser-"));

require("esbuild").buildSync({
  entryPoints: [join(__dirname, "result-protocol.fixture.tsx")], bundle: true,
  outfile: join(output, "bundle.js"), jsx: "automatic", absWorkingDir: repository,
  alias: { react: join(repository, "node_modules/react"), "react-dom": join(repository, "node_modules/react-dom") },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
});
execFileSync(process.execPath, [require.resolve("tailwindcss/lib/cli"), "-i", "app/globals.css", "-o", join(output, "styles.css")], { cwd: repository });
writeFileSync(join(output, "index.html"), '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><body><div id="root"></div><script src="bundle.js"></script></body></html>');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  const server = createServer((request, response) => {
    const name = new URL(request.url, "http://localhost").pathname === "/" ? "index.html" : new URL(request.url, "http://localhost").pathname.slice(1);
    if (!["index.html", "styles.css", "bundle.js"].includes(name)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "text/html" });
    response.end(readFileSync(join(output, name)));
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.getByRole("heading", { name: "Ergebnisprotokoll.md", exact: true }).waitFor();
    await page.screenshot({ path: join(output, "initial-live.png"), fullPage: true });
    assert.equal(await page.getByRole("region", { name: "Quelle" }).isVisible(), true);
    assert.equal(await page.getByRole("region", { name: "Ergebnis" }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Protokoll exportieren", exact: true }).isDisabled(), true);
    for (const name of ["Als Ergebnisprotokoll speichern", "Neu laden", "Protokoll exportieren"]) {
      assert.equal(await page.getByRole("button", { name, exact: true }).evaluate(element => element.getBoundingClientRect().height), 32);
    }
    assert.equal(await page.getByText("2 Ergebnisblöcke aus 1 TOPs ausgewählt", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("Für 1 von 2 TOPs wurde kein Ergebnis erkannt", { exact: true }).isVisible(), true);
    await page.getByRole("link", { name: /Protokoll/ }).click();
    await page.getByRole("dialog").getByRole("heading", { name: "Ungespeicherte Änderungen" }).waitFor();
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    const decision = page.locator("[data-result-source-block]", { hasText: "Als Beschluss erkannt" });
    const discussion = page.locator("[data-result-source-block]", { hasText: "Diskussion zum Antrag." });
    const decisionBox = await decision.boundingBox(); const decisionToggleBox = await decision.getByRole("checkbox").boundingBox();
    assert.ok(decisionToggleBox.x > decisionBox.x + decisionBox.width * 0.75, "selection control should sit at the inner/right edge of the source pane");
    assert.notEqual(await decision.evaluate(node => getComputedStyle(node).backgroundColor), await discussion.evaluate(node => getComputedStyle(node).backgroundColor), "selected and unselected blocks need distinct backgrounds");
    assert.equal(await decision.getByRole("checkbox").isChecked(), true);
    assert.equal(await discussion.getByRole("checkbox").isChecked(), false);
    await discussion.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    const raw = page.getByRole("textbox", { name: "Ergebnisprotokoll Markdown", exact: true });
    assert.ok((await raw.inputValue()).startsWith("---\nintern: true\n---\n# Ergebnisprotokoll"));
    assert.ok((await raw.inputValue()).includes("Diskussion zum Antrag."));
    await raw.fill(`${await raw.inputValue()}\nManuelle Ergänzung bleibt.\n`);
    await page.getByRole("button", { name: "Live Vorschau", exact: true }).click();
    await discussion.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    assert.ok(!(await raw.inputValue()).includes("Diskussion zum Antrag."));
    assert.ok((await raw.inputValue()).includes("Manuelle Ergänzung bleibt."));
    await raw.fill((await raw.inputValue()).replace("Beschluss: Der Antrag wird angenommen.", "Beschluss: Der Antrag wird mit Änderung angenommen."));
    await page.getByRole("button", { name: "Live Vorschau", exact: true }).click();
    await decision.getByRole("checkbox").click();
    await page.getByRole("dialog").getByRole("heading", { name: "Bearbeiteten Block entfernen?" }).waitFor();
    assert.equal(await page.getByRole("dialog").getByText("Dieser übernommene Quellblock wurde im Ergebnisprotokoll verändert. Beim Entfernen geht diese Fassung aus dem aktuellen Entwurf verloren.", { exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    assert.equal(await decision.getByRole("checkbox").isChecked(), true);
    await decision.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Bearbeiteten Block entfernen", exact: true }).click();
    assert.equal(await decision.getByRole("checkbox").isChecked(), false);
    await decision.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    assert.ok((await raw.inputValue()).includes("Beschluss: Der Antrag wird angenommen."));
    assert.ok(!(await raw.inputValue()).includes("mit Änderung angenommen"));
    await page.getByRole("button", { name: "Als Ergebnisprotokoll speichern", exact: true }).click();
    await page.getByRole("button", { name: "Speichern", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Protokoll exportieren", exact: true }).isEnabled(), true);
    await page.getByRole("button", { name: "Protokoll exportieren", exact: true }).click();
    await page.getByRole("dialog").getByRole("heading", { name: "Protokoll exportieren", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "PDF-Dateiname", exact: true }).inputValue(), "Ergebnisprotokoll.pdf");
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    assert.equal((await page.evaluate(() => window.saved.length)), 1);
    assert.equal((await page.evaluate(() => window.source)), ["---", "intern: true", "---", "# Sitzung September", "", "## TOP 1 Bericht", "Diskussion zum Antrag.", "", "Beschluss: Der Antrag wird angenommen.", "", "Abstimmung: 4 Ja, 0 Nein", "", "## TOP 2 Verschiedenes", "Allgemeine Aussprache ohne Beschluss."].join("\n"));
    await page.screenshot({ path: join(output, "desktop.png"), fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(base);
    assert.equal(await mobile.getByRole("region", { name: "Quelle" }).isVisible(), true);
    assert.equal(await mobile.getByRole("region", { name: "Ergebnis" }).isVisible(), false);
    const manual = mobile.locator("[data-result-source-block]", { hasText: "Allgemeine Aussprache ohne Beschluss." }).getByRole("checkbox");
    await manual.focus(); await mobile.keyboard.press("Space");
    assert.equal(await mobile.getByRole("region", { name: "Ergebnis" }).isVisible(), true);
    await mobile.getByRole("tab", { name: "Quelle", exact: true }).click();
    assert.equal(await mobile.getByRole("region", { name: "Quelle" }).isVisible(), true);
    await mobile.screenshot({ path: join(output, "mobile.png") });
    await mobile.close();

    const scrollPage = await browser.newPage({ viewport: { width: 1200, height: 520 } });
    await scrollPage.goto(`${base}?scroll`);
    const scrollSourcePane = scrollPage.getByRole("region", { name: "Quelle" });
    const scrollResultPane = scrollPage.getByRole("region", { name: "Ergebnis" });
    for (const pane of [scrollSourcePane, scrollResultPane]) {
      assert.ok(await pane.evaluate(root => root.querySelector('[data-document-end-space]').getBoundingClientRect().height >= root.clientHeight * 0.35));
    }
    await scrollSourcePane.evaluate(node => { node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.63; node.dispatchEvent(new Event("scroll")); });
    await scrollPage.waitForFunction(() => {
      const panes = [...document.querySelectorAll('section[aria-label="Quelle"], section[aria-label="Ergebnis"]')];
      const ratios = panes.map(node => node.scrollTop / (node.scrollHeight - node.clientHeight));
      return ratios.every(Number.isFinite) && Math.abs(ratios[0] - ratios[1]) < 0.03;
    });
    await scrollResultPane.evaluate(node => { node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.24; node.dispatchEvent(new Event("scroll")); });
    await scrollPage.waitForFunction(() => {
      const panes = [...document.querySelectorAll('section[aria-label="Quelle"], section[aria-label="Ergebnis"]')];
      const ratios = panes.map(node => node.scrollTop / (node.scrollHeight - node.clientHeight));
      return ratios.every(Number.isFinite) && Math.abs(ratios[0] - ratios[1]) < 0.03;
    });
    await scrollPage.close();

    const attendancePage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await attendancePage.goto(`${base}?attendance`);
    const attendanceTable = attendancePage.locator("[data-result-source-block]", { hasText: "Anna" });
    await attendanceTable.getByRole("checkbox").click();
    await attendancePage.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    const attendanceRaw = attendancePage.getByRole("textbox", { name: "Ergebnisprotokoll Markdown", exact: true });
    const attendanceMarkdown = await attendanceRaw.inputValue();
    assert.ok(attendanceMarkdown.indexOf("## Anwesenheit") < attendanceMarkdown.indexOf("### Mitglieder"));
    assert.ok(attendanceMarkdown.indexOf("### Mitglieder") < attendanceMarkdown.indexOf("| Anna | Ja |"));
    assert.ok(attendanceMarkdown.indexOf("| Anna | Ja |") < attendanceMarkdown.indexOf("## TOP 1 Bericht"));
    assert.ok(!/\n{3,}/.test(attendanceMarkdown), "managed result output must not contain runs of empty lines");
    await attendancePage.getByRole("button", { name: "Live Vorschau", exact: true }).click();
    const attendanceHeadingBox = await attendancePage.getByRole("region", { name: "Ergebnis" }).getByText("Anwesenheit", { exact: true }).boundingBox();
    const membersHeadingBox = await attendancePage.getByRole("region", { name: "Ergebnis" }).getByText("Mitglieder", { exact: true }).boundingBox();
    assert.ok(membersHeadingBox.y >= attendanceHeadingBox.y + attendanceHeadingBox.height, "nested headings must render on separate lines");
    await attendancePage.screenshot({ path: join(output, "attendance-live.png"), fullPage: true });
    await attendancePage.close();

    const existingPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await existingPage.goto(`${base}?existing`);
    await existingPage.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    const existingRaw = existingPage.getByRole("textbox", { name: "Ergebnisprotokoll Markdown", exact: true });
    assert.equal(await existingRaw.inputValue(), "# Vorhandenes Ergebnis\n\nManuell in Nextcloud gepflegter Inhalt.\n");
    assert.equal(await existingPage.getByRole("button", { name: "Speichern", exact: true }).isVisible(), true);
    assert.equal(await existingPage.getByRole("button", { name: "Als Ergebnisprotokoll speichern", exact: true }).count(), 0);
    await existingPage.close();
  } finally {
    await browser.close(); await new Promise(resolveClose => server.close(resolveClose));
    console.log(`Browser artifacts: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
