# Security- und Bug-Audit seit 2.7.0

Stand: 04.09.2026. Alle unten aufgeführten Befunde wurden im Arbeitsverzeichnis
korrigiert. Es wurde kein Commit erstellt und nichts veröffentlicht oder deployed.

## Umfang

Ausgangspunkt ist Commit `2da68fb` (Version 2.7.0; kein entsprechender Git-Tag
vorhanden), Endpunkt des untersuchten Verlaufs ist `a7c8b9a`. Der Vergleich umfasst
18 nachfolgende Commits und 497 geänderte Dateien. Bei 262 Dateien besteht der
Unterschied ausschließlich aus Lizenz-/Copyright-Kopfzeilen; die übrigen
Änderungen wurden nach Funktionsbereichen geprüft.

Schwerpunkte waren Autorisierung und Feldsichtbarkeit, öffentliche und interne
APIs, Mehrfach-Budgetzuordnungen, Protokollbereiche und Finanzverknüpfungen,
Nextcloud-Pfade und Dateizugriffe, Markdown-/PDF-Verarbeitung, Editorzustände,
Migrationen sowie Abhängigkeiten. Maßgeblich sind die aktuellen Verträge in
`CLAUDE.md`, `README.md`, den API-Dokumenten und dem Datenbankschema.

## Befunde und Korrekturen

| Befund | Auswirkung | Korrektur und Nachweis |
| --- | --- | --- |
| Ausgeblendete Kartenfelder wurden teilweise weiterhin an den Browser übertragen. | Interne Notizen, Antragsteller- und Finanzdaten konnten in Client-Props bzw. Kanban-Suchtext stehen, obwohl das Board das Feld ausblendete. Auch Aufgabenübersicht und Basisdaten der Protokollvorschläge waren betroffen. | Gemeinsame serverseitige Maskierung vor Serialisierung und Suchtextaufbau; Vorschläge beachten ebenfalls die aktuelle Sichtbarkeit. Unit-/DB-Tests sowie echte HTTP-Prüfungen der Karten-, Board- und Aufgabenseiten belegen die Korrektur. Gespeicherte Werte bleiben erhalten. |
| Direkte Protokollaktionen umgingen Teile der aktuellen Pfad-/Identitätsprüfung. | Ein registrierter alter Protokollpfad konnte nach Änderung der Bereichswurzel weiterhin verwendet werden; beim Speichern ohne erwartete Datei-ID entfiel die zusätzliche Dateiprüfung. | Laden und Speichern verwenden dieselbe Auflösung wie der Dokumenteditor: aktuelle Bereichswurzel, Sitzungsordner, registrierte Datei und Dateiidentität. Ein Regressionstest mit kontrollierten Bereichs- und Dateidaten prüft den veralteten registrierten Pfad. |
| Alte Finanzverknüpfungen waren bei geänderter Board-Konfiguration unzureichend abgesichert. | Eine berechtigte Person im neu konfigurierten Board konnte beim Abgleich auch Referenzen im zuvor verknüpften Board verändern, ohne dort Zugriff zu haben. | Vor dem Nextcloud-Schreiben werden zusätzlich die Berechtigungen auf allen tatsächlich bisher verknüpften Boards geprüft. Bestehende Berechtigungsprüfungen auf das aktuelle Board bleiben bestehen. |
| Parallele Protokollabgleiche konnten manuelle Beschlussreferenzen überschreiben. | Referenzen wurden ohne vorherige Kartensperre gelesen; zwischen Lesen und Schreiben konnte ein anderer Vorgang die Karte ändern. | Abgleich und Löschbereinigung sperren die Sitzung und betroffene Karten in stabiler Reihenfolge. Ein deterministischer DB-Test hält eine manuelle Änderung offen, prüft die Sperrwartezeit und belegt, dass die manuelle Referenz erhalten bleibt. Netzwerkzugriffe finden außerhalb dieser Transaktionen statt. |
| Die Bereinigung automatischer Beschlussreferenzen war unvollständig. | Nach Entfernen des Finanzboards blieben automatische Referenzen stehen. Beim Entfernen einer Verknüpfung konnte außerdem eine bereits als widersprüchlich markierte Referenz als Ersatz übernommen werden. | Gemeinsame Bereinigung auch ohne konfiguriertes Board; Ersatzwerte stammen nur aus nichtleeren, konfliktfreien automatischen Referenzen. Beide Fälle sind durch DB-Regressionen abgedeckt. |
| Budgetrevision, Kartensummen und Positionszeilen konnten aus unterschiedlichen Datenbankständen stammen. | Gleichzeitiges Speichern konnte einen widersprüchlichen Editorzustand oder unnötige Revisionskonflikte erzeugen. | Gemeinsamer schreibgeschützter Repeatable-Read-Snapshot beim Öffnen und Nachladen. Ein DB-Test liest Snapshots während paralleler Budgetänderungen und prüft die Übereinstimmung von Positionen und Summen. |
| Markdown-Downloads verließen sich auf die vorab gemeldete Dateigröße. | Veränderte oder unzutreffende Metadaten und gestreamte Antworten konnten das Speicherlimit umgehen; die gesamte Leseoperation hatte keine gemeinsame Zeitgrenze. | Tatsächlich empfangene Bytes werden gezählt, bei mehr als 2.000.000 Bytes wird abgebrochen. Stat und Download teilen ein 30-Sekunden-Limit. Verzeichnisse werden abgewiesen. Lesen und Schreiben verwenden dasselbe Bytelimit. Tests decken falsche Größenangaben, Streaming und aufgeteilte UTF-8-Zeichen ab. |
| Während „Neu laden“ konnte weitergeschriebener Markdown verloren gehen. | Die verspätete Serverantwort ersetzte zwischenzeitlich eingegebenen Text. | Live- und Rohtexteditor sind während des Ladens schreibgeschützt; Moduswechsel und verändernde Editoraktionen werden gesperrt. Browserregressionen verzögern die Antwort gezielt und prüfen beide Modi. |
| Generierte Ordner-/Dateinamen erfüllten nicht immer die späteren Pfadregeln. | Steuerzeichen, spezielle WebDAV-Pfadmarker oder zu viele UTF-8-Bytes konnten zu erstellten, anschließend nicht regulär nutzbaren Ressourcen führen. | Gemeinsame Pfadvalidierung bereits bei Konfiguration/Namensgenerierung; zusätzlich zur Zeichenbegrenzung gilt eine 255-Byte-Grenze. Regressionstests decken die problematischen Namen ab. |
| Bekannte Schwachstellen im npm-Entwicklungsbaum. | Der Ausgangsscan meldete sechs betroffene Pakete einschließlich transitiver Meldungen: eine hohe, vier mittlere und eine niedrige Einstufung. Das sind nicht sechs voneinander unabhängige Sicherheitslücken. | browserslist auf 4.28.9 und postcss-selector-parser auf 6.1.4 aktualisiert; der alte esbuild-Zweig erhält einen gezielten Override auf ^0.25.12. Kein Drizzle-Downgrade und keine neue Produktionsabhängigkeit. Der abschließende vollständige npm-Scan meldet null Befunde. |

Weitere kleine Härtung: Protokollbereichs-/Sitzungsabfragen weisen IDs außerhalb
des positiven PostgreSQL-Integerbereichs vor der Abfrage zurück.

Die Browser-Bildprüfung wurde außerdem gegen minimale Chromium-Kantenglättungs-
abweichungen stabilisiert: identische Abmessungen und exakte Layoutgeometrie
bleiben zwingend; erlaubt ist höchstens eine Kanalstufe Unterschied bei 0,01 %
der Pixel. Das ist eine Testkorrektur, kein Sicherheitsbefund.

Die Abhängigkeitskorrekturen berücksichtigen unter anderem die offiziellen
[browserslist-Hinweise](https://github.com/browserslist/browserslist/security/advisories/GHSA-c83g-rgw3-j3cx)
und die [esbuild-Advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99).
Die esbuild-Meldung betrifft dessen Entwicklungsserver; daraus folgt keine
gleichartige Erreichbarkeit im produktiven Next-Server.

## Durchgeführte Verifikation

| Prüfung | Ergebnis |
| --- | --- |
| `npm test` mit isoliertem, migriertem PostgreSQL und lokalem Python-PDF-Renderer | **166 bestanden, 0 fehlgeschlagen, 0 übersprungen** |
| Upgrade-Test mit zusätzlicher leerer, isolierter Datenbank | Bestanden, einschließlich Erhalt alter Kartenwerte, Tokens, Dateien und Trigger |
| `npx tsc --noEmit` | Bestanden |
| `npm run lint` | Bestanden; nur der Hinweis auf die künftige Ablösung von `next lint` |
| `npx drizzle-kit check` | Bestanden, auch mit dem gezielten esbuild-Override |
| `npm run build` in separater Arbeitskopie | Bestanden; produktiver Next-Build und Seitengenerierung |
| `git diff --check` | Bestanden |
| `tests/browser/markdown-live.cjs` | Bestanden bei 1500, 600 und 390 Pixeln, einschließlich verzögertem Neuladen |
| `tests/browser/workflows.cjs` | Bestanden auf Desktop und Mobilgerät: Budgeteditor und Upload-Warteschlangen |
| `tests/browser/protocol-settings.cjs` | Bestanden auf Desktop und Mobilgerät |
| `tests/browser/protocol-folders.cjs` | Bestanden auf Desktop und Mobilgerät |
| `tests/browser/workflows-production.cjs` | Bestanden gegen den gebauten Next-Server: echte Server Actions, öffentliche HTTP-Abläufe, lokale Dateien und HTML-Datenschutzregressionen |
| `npm audit --json` | **0 bekannte Schwachstellen**, einschließlich Entwicklungsabhängigkeiten |
| `pip-audit` der 15 gepinnten PDF-Abhängigkeiten | **0 bekannte Schwachstellen** |

Alle Datenbankprüfungen liefen gegen einen eigens gestarteten temporären
PostgreSQL-Container. Reguläre Entwicklungs- und Produktionsdaten wurden nicht
für Tests verwendet. Browserprüfungen nutzten synthetische Daten, lokale
Dateien und Loopback-Server. Der produktionsnahe HTTP-Test verwendete eine
synthetische Sitzung ohne Kontakt zu einem echten OIDC-Anbieter.

## Grenzen und verbleibende Punkte

- Kein bestätigter, oben aufgeführter Befund bleibt ohne Korrektur. Ein Audit
  und erfolgreiche Tests können die Abwesenheit weiterer Fehler nicht beweisen.
- Echte Nextcloud-Instanzen, reale OIDC-Anmeldung, produktiver nginx und das
  ausgerollte Docker-System wurden nicht verändert oder live geprüft. Deren
  Konfiguration, Verhalten und mögliche bereits erfolgte Datenzugriffe lassen
  sich aus diesem lokalen Audit nicht abschließend beurteilen.
- Die PDF-Tests einschließlich des lokalen Renderers liefen vollständig.
  Der optionale Browserlauf mit einer zusätzlich bereitzustellenden realen
  Legacy-PDF-Beispieldatei (`pdf-legacy.cjs`) wurde nicht ausgeführt.
- Das in `CLAUDE.md` ausdrücklich festgelegte überschreibende Markdown-Speichern
  ohne ETag-Konfliktsperre bleibt bestehen. Gleichzeitige externe Änderungen
  können daher weiterhin durch einen späteren Speichervorgang ersetzt werden.
  Die Korrektur der Datenbankrennen ändert diesen Produktvertrag nicht.
- Bereits dokumentierte Betriebsentscheidungen, etwa die begrenzte CSP und
  prozesslokale Rate-Limits, werden durch diesen Audit nicht zu umfassenderen
  Schutzmechanismen. Abhängigkeitsscans gelten für den genannten Prüfzeitpunkt.

Es wurden keine Datenbankschemaänderungen, zusätzlichen öffentlichen
API-Funktionen oder neuen Produktionsabhängigkeiten eingeführt.
