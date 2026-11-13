# Lokale Docker-Testumgebung

Start aus dem Repository:

```bash
bash docker/local-test/start.sh
```

Voraussetzungen: Docker Desktop mit laufender Engine und Compose, Python 3,
Zugriff auf Docker Hub, GHCR und npm. Die erste Ausführung baut den aktuellen
Gremio-Arbeitsstand und lädt `ghcr.io/leviora-studio/limen:latest`.
`LIMEN_TAG` kann in `.env.local` auf eine bestimmte Version gesetzt werden.
Limen und sein Seed verwenden ausdrücklich `linux/amd64`, da das Registry-Image
keine ARM64-Version anbietet. Auf Apple Silicon laufen beide per Docker-Emulation;
Gremio und PostgreSQL verwenden weiterhin die native Architektur.

Gremio: http://localhost:3010, Limen: http://localhost:3000.
Beide Ports sind nur an Loopback gebunden. Login: `demo-admin`;
das zufällig erzeugte Passwort wird nach erfolgreichem Start angezeigt und
steht in der ignorierten Datei `docker/local-test/.env.local`.
Die Testumgebung verwendet localhost und Secure-Cookies; den Browser mit
`localhost` öffnen, nicht über eine LAN-IP.

Dieser eigenständige Compose-Stack verwendet eigene benannte Volumes und
zwei getrennte PostgreSQL-Datenbanken. Die normalen `pgdata`-/`uploads`-Ordner
und eine vorhandene `.env` werden nicht verwendet. Die Datenbanken haben
keine veröffentlichten Host-Ports. SMTP und Nextcloud sind nicht konfiguriert.
Alle Beispieldaten sind fiktiv. Der erneute Start ergänzt fehlende Demo-Anträge,
ersetzt aber keine bearbeiteten Sitzungen oder Vorlagen.

Enthalten sind ein Antragsboard mit vier Karten und eine Sitzung unter
„Demo – StuRa Köthen“: Haupt-/Unter-TOPs, Beschlussvorschläge, ein vertagter und
ein vertraulicher TOP sowie eine einfache Wordvorlage. Hier lassen sich die
Downloads für Tagesordnung und Protokollvorlagen ausprobieren.
Das Limen-Adminportal kann zusätzlich die Einrichtung eines zweiten Faktors
verlangen; für den normalen SSO-Login bei Gremio ist das nicht erforderlich.

Status und Logs:

```bash
docker compose --env-file docker/local-test/.env.local -f docker/local-test/compose.yml ps -a
docker compose --env-file docker/local-test/.env.local -f docker/local-test/compose.yml logs --tail=100
```

Stoppen, mit Erhalt der Beispieldaten:

```bash
docker compose --env-file docker/local-test/.env.local -f docker/local-test/compose.yml down
```

Die Konfiguration und Seeds sind vorbereitet. Ein erfolgreicher Docker-Build,
Start und SSO-Durchlauf müssen in einer Umgebung mit Docker-Zugriff geprüft werden.
