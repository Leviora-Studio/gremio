# API-Abgleich seit v2.7.7

> Historical audit: the meeting-minutes feature has since been removed. References
> to protocol routes, editors and tests below describe the audited version only.

> Historischer Audit vom 4. September. Die anschließend ausdrücklich beauftragte
> interne API-/MCP-Erweiterung ergänzt Kataloge, Suche, Kommentare, Verlauf und
> Kartenanhänge. Der aktuelle Vertrag steht in [API.md](API.md) und [MCP.md](MCP.md).

Stand: 4. September 2026. Geprüft wurden `v2.7.7..HEAD` sowie die vorhandenen,
noch nicht veröffentlichten Änderungen (Haushaltspositionen, öffentliche Uploads,
PDF-Kompatibilität). Dies ist keine neue Versionsfreigabe.

Der beauftragte Umfang bleibt die bestehende REST-API: Boards/Karten mit
persönlichen Tokens und öffentliche Anträge/Feedback. Nicht jede Webfunktion
wird dadurch zu einer externen API.

## Ergebnis nach Funktionsbereich

| App-Änderung / Vertrag | API-Abdeckung und Ergebnis |
| --- | --- |
| v2.7.8: Erklärung zur Standortauswahl | Reine Formularanzeige; Standortliste und Routing verwenden unverändert dieselben fachlichen Grundlagen. Kein neuer API-Parameter nötig. |
| v2.7.9: Kartenfelder für Mitglieder | Aktivierte Nummer/Anweisungsdatum/Überweisungsdatum bereits schreibbar. Veraltete Eigentümer/Admin-Beschränkungen in OpenAPI und Fachkonzept korrigiert. |
| Mehrere Haushaltstitel/Konten je Karte | `budgetMode`, `budgetRevision`, Detailpositionen und PATCH vorhanden. POST um atomare Anlage inklusive Positionen ergänzt; Einzelkarten-Anlage bleibt kompatibel. |
| Positionsdaten und Summen | Gemeinsamer Writer mit UI: Reihenfolge, stabile UUIDs, Konto-Pflicht, Cent-/Summenlimits, `null` vs. `0`, sichtbare Werte bereits beim ersten Wechsel editierbar, ausgeblendete Werte geschützt. Fremde Positions-IDs werden als Eingabefehler abgewiesen. |
| Parallele Budgetänderungen | PATCH verlangt die zuletzt gelesene Revision. Karte, Summen, Revision und Detailpositionen werden bei GET/POST/PATCH aus demselben lesenden DB-Snapshot ausgegeben. Fehler hinterlassen keine teilweise Budgetänderung. |
| Zuständige und persönliche Kartenliste | Fehler korrigiert: Ein PATCH nur mit `assigneeUserIds` wurde als leer behandelt. Setzen und vollständiges Entfernen mit `[]` wirken jetzt auch ohne weitere Felder. |
| Mehrere Archiv-/Quittungsspalten | `isArchiveTrigger` bereits vollständig pro Spalte. `isReceiptTrigger`, der fehlende `isTransferTrigger` und Board-Ziele `receiptToStatusId`/`resubmitStatusId` ergänzt; Einstellungen nur für Eigentümer/Admins sichtbar. |
| Spaltenwechsel | Bestehende gemeinsamen Helfer setzen Anweisungs-/Überweisungsdatum, stoßen Archivierung an und aktualisieren Nachreichungsmarkierung sowie Done-Frist. |
| Öffentlicher Antragsstatus | Genehmigte Gesamtsumme und unabhängige `canResubmit`/`canReceipt` bereits angebunden. Schema-Pflichtfelder und Beispiele nachgezogen. Archiv-Sperre und gültige Quittungs-Zielspalte bleiben maßgeblich. |
| Öffentliche Einreichung / Feedback | Keine neue Eingabe erforderlich. Routing, Idempotenz, Token-Typtrennung und Limits bleiben bestehen; Feedback hat weiterhin weder Upload-Aktionen noch Budgetdaten. |
| Ungültige IDs / Filter | Pfad-IDs außerhalb positiver int32-Werte ergeben 404; ungültige Status-/Archivfilter 400. Schreib-IDs werden vor DB-Zugriff auf den Wertebereich geprüft. |
| API-Spezifikationen | Getrennte Schreib-/Lese-Positionsschemas, Pflicht-Titel beim POST, aktuelle Berechtigungen und Antwortfelder; beide YAML-Dateien aus den TS-Quellen neu generiert. |

## Bewusste Grenzen

- Protokollbereiche, Nextcloud-Dateien, Logos, Markdown-Editor, Sitzungsdaten und
  PDF-Export/-Bearbeitung bleiben Webfunktionen mit Session-/Bereichsprüfung und
  Server Actions. Die neuen `/api/protokolle/...`-Routen sind keine Erweiterung
  der externen Bearer-API. Die PDF-Kompatibilitätskorrektur wirkt über den
  gemeinsamen PDF-Helfer auch in den vorhandenen sessiongeschützten Feldrouten.
- Datei-Uploads auf Statusseiten und das abschließende Einreichen bleiben
  Webaktionen. Die öffentliche Status-API meldet deren Verfügbarkeit und liefert
  Download-Links, führt diese Aktionen aber nicht selbst aus.
- Board-/Finanz-/Inventarverwaltung erhält keine neuen REST-Schreibendpunkte.
  Karten auf Inventar-Systemboards bleiben über REST nur lesbar.
- Listen liefern Karten mit Gesamtsummen; Positionskonten und einzelne Titel
  stehen in der Detailantwort. Öffentliche Antworten enthalten niemals diese
  internen Zuordnungen. Konto-/Prioritätskataloge bleiben außerhalb des Vertrags;
  die bestehenden Schreibfelder verwenden bekannte IDs.

## Kompatibilität und Betrieb

Keine zusätzliche Migration über die für die App bereits notwendige `0062`
hinaus, keine neue Produktionsabhängigkeit. Der bestehende Namespace `/api/v1`
bleibt erhalten. Bestehende gültige Einzelkarten-Aufrufe funktionieren weiter.
Ungültige Filter, alleinstehende `budgetRevision` und übergroße IDs werden nun
explizit abgewiesen statt ignoriert bzw. an die Datenbank weitergereicht.

Für Positions-PATCHes `position` aus Leseobjekten entfernen und die zuletzt
gelesene `card.budgetRevision` mitsenden. UUIDs nur für dieselbe Position
wiederverwenden. Neue Karten/Positionen benötigen neue UUIDs. Keine vertraulichen
Status-Tokens, Nextcloud-Zugangsdaten oder echten Dokumente in Tests kopieren.

## Regressionen und Pflege

- `tests/api-parity.test.ts`: echte versionierte Route Handler mit isolierten
  DB-Fixtures und Bearer-Tokens; Rechte, Sichtbarkeit, Positionen, Rollbacks,
  Zuständige, Trigger, Filter, Widerruf und Löschen.
- `tests/api-contract.test.ts`: vollständiges Routen-/Methodeninventar beider
  Namespaces, Eingabefelder, Beispiele und Gleichheit der generierten YAML-Dateien.
- `tests/public-budget-workflows-db.test.ts`: gemeinsame Budget-/Workflow-Logik,
  öffentliche Summen/Gates, mehrere Quellen, Archiv-Vorrang und Upload-Quota.
- `tests/browser/workflows-production.cjs`: reale Next-HTTP-/Server-Action-Checks
  gegen eine isolierte Testdatenbank, einschließlich öffentlicher Statusantworten.
- Bestehende Routing-, Idempotenz-, Public-Origin-, Leihkarten- und
  PDF-Kompatibilitätsregressionen bleiben Teil von `npm test`.

Bei künftigen fachlichen Änderungen gemeinsame Helfer, REST-Eingaben/-Ausgaben,
Rechte und beide OpenAPI-Quellen prüfen; anschließend `npm run openapi:yaml` und
die relevanten Tests ausführen. `AGENTS.md` verweist auf diese Pflegepflicht.

### Durchgeführte Prüfung dieses Arbeitsstands

- `npm test`: 162 Tests, davon 161 erfolgreich und 1 übersprungen; keine Fehler.
  Der separate Migrationstest wurde ohne `TEST_MIGRATION_DATABASE_URL` nicht
  erneut ausgeführt. Dieser API-Abgleich verändert keine Migration.
- `npx tsc --noEmit`, `npm run lint`, `git diff --check`: erfolgreich.
- `npm run build`: erfolgreich in einer separaten temporären Projektkopie,
  ohne den `.next`-Ordner des laufenden Entwicklungsservers zu verwenden.
- `workflows-production.cjs`: erfolgreich am separat gestarteten Next-Server
  mit realen HTTP-Aufrufen, Browser, lokaler Dateispeicherung und isolierter DB.

Keine Produktion, echte Nextcloud-Archivierung oder externes OIDC-System wurde
für diese Tests angesprochen. Keine zusätzlichen Abhängigkeiten, Commits oder
Veröffentlichungen im Rahmen des Abgleichs.

## Begrenzte Board-Verwaltung

Migration 0102 ergänzt personenbezogene Verwaltungsrechte für normale Boards und Antragsboards. Die festgelegten Teilbereiche werden in der UI und ihren Server Actions über eine separate Live-Prüfung freigegeben; volle Eigentümerprüfungen bleiben unverändert. Der bestehende REST-/MCP-Umfang umfasst keine Board-Einstellungsänderungen oder Ernennungen und wird nicht erweitert. Delegierte Verwalter bleiben API-Mitglieder; Finanzboard-, Kassenbuch-, Inventar- und öffentliche Rechte ändern sich nicht. `tests/board-management-db.test.ts` prüft direkte/Gruppen-Schreibrechte, Live-Entzug, ausgeschlossene Einstellungen und Ressourcenarten.

## Verfügbare Status-Trigger

Datums-Trigger und zugehörige automatische Zuweisungen sind vollständig deaktiviert, auch für historische Konfigurationen und Statuswechsel über REST/MCP, Sitzungen oder öffentliche Einreichung. Datumswerte/manuelle Altfelder bleiben erhalten. Nextcloud-Archiv-Trigger funktionieren auf normalen Boards und Antragsboards wie bisher. Nur die Done-Spalte entfällt auf Antragsboards; Sweep, Done-Zuweisungen, Suchfilter und Statistiken ignorieren dort alte Done-Konfigurationen. Die bestehenden Antwortfelder bleiben kompatibel (`isInstructionTrigger`/`isTransferTrigger` immer false, `doneStatusId` auf Antragsboards null). Gemeinsame Policy, Status-/Uploadprüfungen und Setter verhindern UI-/API-Abweichungen; Regressionen in `application-archive-trigger-db.test.ts`, `api-parity.test.ts` und `application-api-freeze-db.test.ts`.

## Begrenzte Inventar-Verwaltung

Migration 0103 ergänzt separate Inventar-Verwaltungsfreigaben ohne automatische Ernennungen. Die Oberfläche und Server Actions erlauben genau Email-Settings des verknüpften Leihboards, Freigaben, Felder und automatische Inventarnummer. Alle anderen Eigentümerprüfungen bleiben unverändert. Keine neuen REST-/MCP-Endpunkte oder Eigentümerrollen; aktuelle Schreibfreigaben bleiben erforderlich. `inventory-management-db.test.ts` prüft erlaubte Aktionen, geschützte Direktaufrufe, zusätzliche Eigentümer, Gruppenrechte, Live-Entzug und fremde/unverknüpfte Boards. Der Browserablauf prüft Vergabe, exakte Einstellungsbereiche, Nummerierungsänderung und Entzug auf Desktop/Mobilgerät.

## Finanzübersichten: Anlage nur für Admins

`createFinanceBoardAction` und der frühere Anlegepfad verlangen Adminrechte; das Formular steht ausschließlich unter `/admin/finanzboards`. REST/MCP werden nicht erweitert. Bestehende Eigentümer-/Schreib-/Leserechte gelten unverändert; Desktop- und Mobilnavigation berücksichtigen aktuelle direkte/Gruppen-Freigaben und Eigentümerschaft über `getAccessibleFinanceBoards`. `finance-creation-db.test.ts` prüft verweigerte Direktaufrufe, Admin-Anlage samt Vorlage und Live-Rechte; die Browserprüfung deckt Admin-Panel, Altpfad und Navigationssichtbarkeit einschließlich Entzug ab.

Nextcloud archiving now uses the confirmed public status and waits while an
application is in an unconfirmed lock column. The shared lock service starts
archiving after commit for UI, REST and MCP. Ordinary archive columns and later
moves of frozen cards still trigger immediately; failed uploads remain retryable.
Migration 0104 allows technical archive bookkeeping on frozen cards while
preserving all content restrictions and making recorded archive links immutable.
No API methods or write fields were added. `frozen-card-archive-db.test.ts` covers
the shared paths; `frozen-card-archive-migration.test.ts` verifies unchanged
existing rows across the upgrade.

New planning account/title pairs are validated by the common writer against the
account's configured expense-plan catalog (409 for missing/invalid catalog
choices). UI, REST and MCP share this restriction. Persisted historical pairs
can be retained but not multiplied; no public/accounting data or catalog read
endpoints were added. Cashbook source selection and title validation remain
session-only. Tests cover the REST/MCP rejection and correct existing writes.


Card-bin follow-up: REST card deletion and MCP `delete_card` now require explicit
`confirmation: "LÖSCHEN"` and use the same 30-day card-bin lifecycle as the UI.
Shared predicates also hide card descendants and retained public/download links.
No restore/purge or cashbook bearer capability is introduced. Input requirements
changed intentionally; clients must supply the confirmation.
