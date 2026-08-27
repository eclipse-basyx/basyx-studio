# BaSyx Studio Setup Guide

Dieser Guide beschreibt das technische Ziel-Setup von BaSyx Studio auf Basis der
[Produktanforderungen](docs/requirements.md), der
[akzeptierten ADRs](docs/adr/README.md) und der
[Architekturdokumentation](docs/architecture/overview.md). Er deckt die drei
priorisierten Betriebsvarianten ab:

1. Hosted Web Studio mit einer oder mehreren Live-AAS-Infrastrukturen
2. Desktop Studio mit Live-AAS-Infrastrukturen
3. Desktop Studio mit lokalem AASX-Workspace

Die App-Plattform, grafische Views, Sicherheit, Tests und Observability werden
als Querschnittsfunktionen mit eingerichtet.

> **Wichtiger Repository-Status:** In diesem Stand sind keine `package.json`,
> kein `pnpm-lock.yaml`, keine Anwendungssourcen und keine Compose-Dateien
> eingecheckt. `pnpm install`, `pnpm dev` und die unten beschriebenen Profile
> sind daher erst ausführbar, nachdem das einmalige Projekt-Bootstrap als
> eigener, reviewbarer Implementierungsschritt erfolgt ist. Dieser Guide erfindet
> keine bereits vorhandenen Skripte oder Konfigurationsnamen.

## 1. Architekturregeln vor dem Setup

Das Setup muss folgende Regeln einhalten:

- Browser und Electron-Renderer sprechen ausschließlich mit der versionierten
  Studio API. OAuth-Tokens, Refresh-Tokens und Client Secrets bleiben im BFF.
- Live-AAS-Zugriffe laufen serverseitig über `basyx-typescript-sdk`.
- Hosted Metadaten liegen in PostgreSQL; Desktop-Metadaten in SQLite und
  AASX-Dateien im vom Benutzer kontrollierten Dateisystem.
- Der Studio Service bleibt ein modularer Nuxt/Nitro-Deployable. Workspace
  Worker und App Runner sind wegen ihrer Trust-/Crash-Grenzen eigene Prozesse.
- HTTP ist der Standard für Queries und Commands, SSE für einseitige
  Fortschritts-/Invalidierungsereignisse. WebSockets benötigen einen konkret
  dokumentierten bidirektionalen Use Case.
- AAS-Modelle werden mit AAS Core beziehungsweise qualifizierter
  Package-Validierung geprüft, nicht mit einem parallelen Zod-Metamodell.
- Installierte Apps und App-Widgets laufen nie im Studio-Service-Prozess oder im
  vertrauenswürdigen Renderer-Kontext.
- Redis, MongoDB, Kafka, MQTT, Kubernetes, Service Mesh, GraphQL, TanStack Query,
  Module Federation und ein separates Dashboard-Backend sind keine
  Baseline-Abhängigkeiten.

Siehe dazu insbesondere
[ADR 0001](docs/adr/0001-runtime-and-service-boundaries.md),
[ADR 0002](docs/adr/0002-bff-and-authentication.md),
[ADR 0005](docs/adr/0005-storage-and-observability.md),
[ADR 0007](docs/adr/0007-http-and-realtime-transports.md) und
[ADR 0008](docs/adr/0008-evolutionary-architecture-and-dependencies.md).

## 2. Setup-Profil auswählen

Nicht jede lokale Installation benötigt alle externen Dienste.

| Profil | Benötigt | Deckt ab |
| --- | --- | --- |
| `web` | Node.js, PNPM, Studio Service | UI-, BFF- und SSR-Entwicklung |
| `hosted-live` | `web`, Docker/Compose, PostgreSQL, OIDC-Test-IdP, eine oder mehrere BaSyx-Go-Testinfrastrukturen | DEP-001, DEP-005, DATA-001/002/011–016, SEC-001–008 |
| `desktop-live` | `web`, Electron-Toolchain, SQLite, OS-Keychain, OIDC-Test-IdP und erreichbare BaSyx-Infrastruktur | DEP-003, DEP-006–008, SEC-007/009 |
| `desktop-aasx` | `web`, Electron-Toolchain, SQLite und später qualifizierter Workspace Worker/Package Engine | DEP-004, DATA-005–007/009 |
| `apps` | OCI-Registry, Cosign/Sigstore-Werkzeuge, Deno-Evaluationsruntime und isolierte Runner | APP-001–016 |
| `observability` | OTel Collector, Prometheus, Tempo, Loki, Alloy und Grafana | OPS-004–006 |

Empfehlung für die tägliche Entwicklung: zunächst `web`, `hosted-live` und die
für das aktuelle Feature relevante Desktop-Variante. App-Plattform und komplette
Observability müssen nur laufen, wenn der bearbeitete vertikale Slice sie nutzt.

### 2.1 Vollständiges Abhängigkeitsinventar

Die folgende Tabelle konsolidiert die in den technischen Dokumenten genannten
Abhängigkeiten. „Akzeptiert“ bedeutet Architektur-Baseline; Versionsnummern
werden nach Kompatibilitätsprüfung im `pnpm-lock.yaml` beziehungsweise im
Container-/Tooling-Lock festgeschrieben.

| Bereich | Abhängigkeit | Status/Installation |
| --- | --- | --- |
| Runtime | Node.js, Corepack, PNPM | Akzeptiert; Node.js ab Version 22, eine freigegebene LTS-Version überall gleich |
| UI/BFF | Vue 3, Nuxt 4, Nitro/H3, TypeScript | Akzeptiert; Nitro/H3 kommt über Nuxt, kein zweites BFF-Framework |
| UI-System | Vuetify, Material Design Icons | Akzeptiert |
| Client State | Pinia | Akzeptiert |
| Komplexer Remote State | Pinia Colada plus Nuxt-Modul | Akzeptiert, aber nur featurebezogen |
| Studio-Validierung | Zod | Akzeptiert für TypeScript-eigene Trust-Boundaries |
| Öffentliche Schemas | JSON Schema 2020-12, Ajv | Akzeptiert; `ajv-formats` für benötigte Standardformate |
| Live AAS | `basyx-typescript-sdk` | Verpflichtend für Live-Zugriffe |
| AAS-Modell | `@aas-core-works/aas-core3.1-typescript` | Verpflichtender, zum SDK passender Peer |
| Hosted-Daten | PostgreSQL | Akzeptierte Baseline und eigener Studio-User/eigenes Schema |
| Desktop-Daten | SQLite und Benutzerdateisystem | Akzeptierte Baseline; konkrete Node-Treiber noch zu qualifizieren |
| DB-Zugriff | Drizzle ORM/Query Builder | Kandidat, noch nicht automatisch installieren |
| Background Jobs | Node Worker, PostgreSQL Job Records; gegebenenfalls Graphile Worker | Prozess-/DB-Baseline akzeptiert, Queue-Library erst bei konkretem Bedarf |
| Desktop | Electron, Electron Builder, Electron Updater, `safeStorage` | Akzeptiert; `safeStorage` ist Electron-Bestandteil |
| AASX | separater Workspace Worker, AAS Package Library, AAS Core | Boundary akzeptiert; Package Engine noch offen |
| App Backend | Deno plus Prozess-/Container-Isolation | Bevorzugtes Evaluation Target, noch zu qualifizieren |
| App Distribution | OCI Registry | Akzeptiert |
| App Trust | Sigstore/Cosign, CycloneDX oder SPDX | Akzeptierte Signatur-/Provenance-/SBOM-Richtung |
| Logging | Pino | Akzeptiert für strukturierte Node-JSON-Logs |
| Telemetrie im Code | OpenTelemetry Node SDK, OTLP Protobuf Exporter, HTTP/Undici/PostgreSQL-Instrumentierung | Akzeptiert, nur selektiv installieren |
| Telemetrieplattform | OTel Collector, Prometheus, Tempo, Loki, Alloy, Grafana | Bestehenden BaSyx-Go-Stack wiederverwenden |
| Unit/Component | Vitest, Vue Test Utils, Nuxt Test Utils | Akzeptiert |
| Browser/E2E | Playwright | Akzeptiert |
| Integration | Testcontainers, OIDC-Test-Provider, qualifizierte BaSyx Targets | Akzeptiert; Keycloak nur Referenz-IdP |
| API-Vertrag | OpenAPI 3.1 | Später aus autoritativen Routen/Contracts generieren, kein doppeltes Handmodell |
| Views | Vue/Vuetify und JSON Schema/Ajv | Akzeptiert; Layout-/Drag-and-drop-Library noch offen |

Künftige interne Pakete wie `@basyx/studio-sdk`,
`@basyx/studio-protocol`, `@basyx/studio-semantic` und
`@basyx/studio-view-schema` werden nicht leer vorab erzeugt. Sie werden erst aus
einem realen Workflow und mindestens einem realen Consumer extrahiert.

## 3. Systemvoraussetzungen installieren

### 3.1 Pflichtwerkzeuge

- Git
- Node.js 22 oder neuer; für CI und Entwicklung dieselbe freigegebene gerade
  LTS-Version. Nuxt 4 setzt aktuell mindestens Node.js 22 voraus; siehe die
  [offizielle Nuxt-Installation](https://nuxt.com/docs/4.x/getting-started/installation).
- Corepack und PNPM; `pnpm-lock.yaml` ist der einzige JavaScript-Lockfile. npm,
  Yarn, Bun und andere Package Manager sind im Projekt verboten.
- Docker Engine beziehungsweise Docker Desktop mit Docker Compose v2 für
  Hosted-, Integrations- und Observability-Profile

Versionen prüfen:

```bash
git --version
node --version
corepack --version
docker version
docker compose version
```

PNPM über Corepack aktivieren:

```bash
corepack enable pnpm
pnpm --version
```

Sobald das Bootstrap eine PNPM-Version im `packageManager`-Feld der
`package.json` festgelegt hat, muss lokal, in CI, in Container-Builds und in
Release-Builds genau diese Version verwendet werden. Es darf kein
`package-lock.json`, `yarn.lock`, `bun.lock` oder zusätzliches Lockfile committed
werden.

#### 3.1.1 Verbindliche PNPM-Supply-Chain-Härtung

Die Härtung übernimmt das im `basyx-aas-web-ui` etablierte Muster und ergänzt es
um die heute in PNPM verfügbare strikte Konfiguration:

1. Die `package.json` führt PNPM als exakt gepinnte Dev Dependency und mit
   SHA-512-Integrität im `packageManager`-Feld, beispielsweise
   `pnpm@X.Y.Z+sha512.HASH`.
2. Ein gemeinsamer Setup-Check aktiviert `corepack enable pnpm`, liest
   `packageManager`, prüft das Präfix `pnpm@` und bricht ab, wenn
   `pnpm --version` nicht der gepinnten Version entspricht.
3. `pnpm-lock.yaml` wird committed. CI, Docker und Releases installieren nur mit
   `pnpm install --frozen-lockfile`.
4. `pnpm-workspace.yaml` erzwingt mindestens folgende Baseline:

```yaml
packages:
  - "."
  - "packages/*"
  - "services/*"

minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
strictDepBuilds: true
blockExoticSubdeps: true
trustLockfile: false

allowBuilds: {}
```

`allowBuilds` startet leer. Wenn eine Dependency einen legitimen Build-,
Install- oder Postinstall-Schritt benötigt, wird nur diese Dependency nach
Prüfung ergänzt. Die Freigabe dokumentiert Paket/Version beziehungsweise
immutable Quelle, Zweck, Risiko und Reviewer. `pnpm approve-builds` darf nicht
blind für alle offenen Einträge ausgeführt werden; `dangerouslyAllowAllBuilds`
ist verboten.

Die expliziten 1.440 Minuten schaffen ein 24-Stunden-Fenster, in dem neu
veröffentlichte kompromittierte Versionen erkannt und aus dem Registry entfernt
werden können. `minimumReleaseAgeStrict: true` verhindert einen stillen Fallback
auf eine zu junge Version. `blockExoticSubdeps` verhindert unerwartete
transitive Git-/Tarball-Quellen. `trustLockfile: false` sorgt dafür, dass PNPM
die Supply-Chain-Regeln auch auf eingereichte Lockfiles erneut anwendet.

Für mehrere Registries werden PNPM Named Registries verwendet, damit die
Herkunft im Lockfile gebunden ist. Registry-Zugangsdaten gehören ausschließlich
in die vertrauenswürdige Benutzer-/CI-Konfiguration; sie dürfen weder im
`pnpm-workspace.yaml` noch in einer committed `.npmrc` stehen.

Dependency-Update-PRs müssen gemeinsam prüfen:

- Manifest und vollständigen `pnpm-lock.yaml`-Diff
- Änderungen an `allowBuilds`
- PNPM-Dev-Dependency und integritätsgepinntes `packageManager`-Feld
- Lizenzen, Advisories, Transitives und Herkunft
- SBOM mit einem Scanner, der das vollständige PNPM-Lockfile versteht

CI Actions werden wie im Referenzprojekt auf vollständige Commit-SHAs gepinnt.
Release-Images erhalten BuildKit-Provenance, SPDX-/CycloneDX-SBOMs,
Vulnerability-Scans und Cosign-Signaturen auf dem immutable Digest. Siehe
[ADR 0010](docs/adr/0010-pnpm-only-supply-chain.md) und die
[PNPM Supply-Chain-Empfehlungen](https://pnpm.io/supply-chain-security).

### 3.2 Zusätzliche Desktop-Werkzeuge

- macOS: Xcode Command Line Tools; für Releases Apple-Zertifikat und
  Notarisierungszugang
- Windows: Visual Studio Build Tools, falls eine qualifizierte native
  SQLite-/Package-Abhängigkeit sie benötigt; für Releases Code-Signing-Zertifikat
- Linux: die von Electron für die Ziel-Distribution benötigten Systembibliotheken
- Zugriff auf den jeweiligen OS-Keychain/Secret Store für Electron `safeStorage`

macOS-Werkzeuge prüfen beziehungsweise anstoßen:

```bash
xcode-select -p
xcode-select --install
```

Release-Signing ist für lokale Entwicklungs-Builds nicht nötig, aber Pflicht für
veröffentlichte Desktop-Installer und Updates.

### 3.3 Zusätzliche App-Plattform-Werkzeuge

- Deno als bevorzugtes, noch zu qualifizierendes Standard-Backend-Runtime-Ziel
- OCI-kompatible Registry
- Cosign/Sigstore-kompatible Signatur- und Attestierungswerkzeuge
- SBOM-Erzeugung im CycloneDX- oder SPDX-Format

Installation prüfen:

```bash
deno --version
cosign version
```

Deno ersetzt keine Container-/OS-Isolation für nicht vertrauenswürdigen Code.
Hosted Backend-Apps müssen zusätzlich in nicht privilegierten, begrenzten
Containern oder Pods laufen.

## 4. Repository prüfen

Im Projekt-Root ausführen:

```bash
git status --short
git branch --show-current
test -f package.json && echo "package.json vorhanden" || echo "Bootstrap erforderlich"
test -f pnpm-lock.yaml && echo "pnpm-lock.yaml vorhanden" || echo "Lockfile fehlt"
```

Unabhängige lokale Änderungen dürfen nicht überschrieben werden. Im aktuellen
Docs-only-Stand ist die Ausgabe `Bootstrap erforderlich`/`Lockfile fehlt`
erwartet.

## 5. Einmaliges Projekt-Bootstrap

Dieser Abschnitt ist nur einmal durch das Team auszuführen und als eigener Pull
Request zu reviewen. Wer das Repository lediglich lokal verwenden möchte,
überspringt ihn nach dem späteren Bootstrap-Commit und fährt mit Abschnitt 6
fort.

### 5.1 Nuxt-Grundlage erzeugen

Die Grundlage ist Vue 3, Nuxt 4, TypeScript, Nitro/H3 und Node.js. Da der Root
bereits Dokumentation enthält, zuerst außerhalb des Roots generieren und die
generierten Dateien anschließend bewusst in einem Implementierungs-Commit
integrieren:

```bash
mkdir -p .bootstrap
pnpm dlx create-nuxt@X.Y.Z .bootstrap/studio
```

`X.Y.Z` ist eine vorab geprüfte, mindestens 24 Stunden alte Version des
Nuxt-Starters. Für das einmalige Bootstrap wird kein ungepinnter `latest`- oder
`pnpm create`-Aufruf verwendet.

Danach müssen mindestens `package.json`, `pnpm-lock.yaml`, Nuxt-Konfiguration,
TypeScript-Konfiguration und die reale App-Struktur geprüft übernommen werden.
`.bootstrap/` ist temporär und darf nicht committed werden. Nicht blind den
Projekt-Root überschreiben.

Im Bootstrap wird anschließend eine geprüfte PNPM-Version exakt gepinnt. Die
gleiche Versionsnummer steht als Dev Dependency und zusammen mit dem aus
`dist.integrity` verifizierten SHA-512-Hash im `packageManager`-Feld:

```bash
pnpm add -D --save-exact pnpm@X.Y.Z
pnpm view pnpm@X.Y.Z dist.integrity
```

Der Hash wird wie im `basyx-aas-web-ui` automatisiert aus der Registry-Antwort
konvertiert und in der Form `pnpm@X.Y.Z+sha512.HASH` geschrieben. Ein
reviewbarer CI-Workflow synchronisiert das Feld bei PNPM-Updates und die
Setup-Prüfung bricht bei jeder Versionsabweichung ab. `X.Y.Z` wird beim
Bootstrap bewusst gewählt; dieser Guide pinnt keine ungeprüfte zukünftige
Version vorab.

Nach der Integration:

```bash
pnpm install
pnpm dev
```

Der erwartete Entwicklungsendpunkt eines Standard-Nuxt-Setups ist
`http://localhost:3000`. Ein anderer Port muss über die reale
Projektkonfiguration dokumentiert werden.

### 5.2 Akzeptierte Kernabhängigkeiten hinzufügen

Die folgenden Pakete bilden den akzeptierten UI-/State-/Validierungs-Stack ab:

```bash
pnpm add nuxt@^4 vue@^3 vue-router@^4 vuetify @mdi/font
pnpm add pinia @pinia/nuxt
pnpm add @pinia/colada @pinia/colada-nuxt
pnpm add zod ajv ajv-formats
pnpm add -D typescript vite-plugin-vuetify sass
```

Dabei gilt:

- Lokaler Component State: Vue Composition API
- UI-Auswahl, aktives Target, Drafts und Undo/Redo: Pinia
- Einfache SSR-/Routendaten: Nuxt `useFetch`/`useAsyncData`
- Pinia Colada nur für komplexen, gemeinsam genutzten Remote State; jeder
  AAS-Query-Key enthält Target-Art, Target-ID und alle Query-Variablen
- Zod nur an Studio-eigenen TypeScript-Trust-Boundaries
- Ajv/JSON Schema 2020-12 für öffentliche Manifest-, Capability- und
  View-Verträge

Falls Nuxt/Vuetify zum Bootstrap-Zeitpunkt eine andere offiziell unterstützte
Integration verlangt, muss die Auswahl gegen
[ADR 0008](docs/adr/0008-evolutionary-architecture-and-dependencies.md)
qualifiziert und im Lockfile fixiert werden.

### 5.3 Live-AAS-Abhängigkeiten hinzufügen

Vor der Installation die SDK-Peer-Abhängigkeiten prüfen:

```bash
pnpm view basyx-typescript-sdk versions --json
pnpm view basyx-typescript-sdk peerDependencies --json
```

Danach freigegebene, zueinander kompatible Versionen einsetzen:

```bash
pnpm add basyx-typescript-sdk@X.Y.Z
pnpm add @aas-core-works/aas-core3.1-typescript@A.B.C
```

`X.Y.Z` und `A.B.C` sind bewusst keine vorgetäuschten Versionsnummern. Die
gewählte SDK-Version und deren AAS-Core-3.1-Peer-Version müssen zusammen im
`pnpm-lock.yaml` festgeschrieben werden. Vor Core-Feature-Arbeit ist ein
Kompatibilitätstest gegen Repository, Registry, Discovery, AASX File Server und
die benötigten semantischen SDK-Funktionen erforderlich.

SDK-Clients laufen ausschließlich im Studio Service. Niemals das SDK mit
Downstream-Credentials im Browser, Renderer oder einer UI-App initialisieren.

### 5.4 Hosted Persistence einrichten

PostgreSQL ist für Hosted-Metadaten, Sessions, Infrastrukturkonfiguration,
Apps, Views, ACLs, Operation Records und Audit die akzeptierte Baseline.

Sobald das Repository eine geprüfte Compose-Datei enthält:

```bash
docker compose up -d postgres
docker compose ps
docker compose logs postgres
```

Für die Datenbank sind mindestens getrennte Werte für Datenbankname, Studio-User
und Passwort als lokale Secrets zu konfigurieren. Produktions-Secrets kommen aus
dem Secret Manager der Zielplattform und nicht aus clientseitiger Runtime-Config
oder gewöhnlichen Datenbankspalten.

Der Datenzugriff ist noch nicht abschließend entschieden. Drizzle ist ein
Kandidat, kein akzeptierter Automatismus. Vor einer Installation muss ein
vertikaler Slice folgende Punkte beweisen:

- geordnete Migrationen von mindestens N−2 unterstützten Versionen
- Transaktionen und PostgreSQL Row Locking
- verständliche PostgreSQL- und SQLite-Repositories
- Electron-Packaging auf allen Zielbetriebssystemen
- dokumentierter Exit-/Migrationspfad

Erst nach dieser Qualifizierung wäre beispielsweise folgender
Implementierungsschritt zulässig:

```bash
pnpm add drizzle-orm
pnpm add -D drizzle-kit
```

Der konkrete PostgreSQL- und SQLite-Treiber ist zusammen mit diesem Slice zu
entscheiden; dieser Guide legt keinen nicht dokumentierten Treiber fest.

### 5.5 Electron und Desktop-Abhängigkeiten hinzufügen

Für den Desktop-Host:

```bash
pnpm add electron-updater
pnpm add -D electron electron-builder
```

Der Electron-Setup ist erst korrekt, wenn folgende Eigenschaften umgesetzt und
getestet sind:

- Renderer-Sandbox aktiv, `contextIsolation` aktiv, keine Node-Integration
- minimale, schema-validierte Preload-/IPC-Bridge
- lokaler Studio Service auf dynamischem Loopback-Port
- One-Time-Launch-Secret zwischen Electron und lokalem Studio Service
- explizite Readiness-, Shutdown- und Crash-Supervision
- OS-geschützte Secret-Ablage mit Electron `safeStorage`
- signierte/notarisierte Installer und signierte Updates
- Upgrade-, Migrations- und Rollback-Tests für aktuelle, N−1- und N−2-Version

Für `desktop-aasx` kommt ein separat überwachter Workspace Worker hinzu. Die
AASX-Package-Engine ist noch nicht ausgewählt und darf erst nach bestandener
Round-Trip-Qualifizierung installiert werden. Die Tests müssen AAS,
Submodels, Concept Descriptions, XML/JSON, Supplementary Files, Thumbnails,
ungewöhnliche gültige Pfade, Metamodellversionen, atomisches Speichern und
Recovery abdecken.

### 5.6 Observability-Abhängigkeiten hinzufügen

Nur die benötigten Node-Instrumentierungen installieren, nicht pauschal das
gesamte Auto-Instrumentation-Paket:

```bash
pnpm add pino
pnpm add @opentelemetry/api @opentelemetry/sdk-node
pnpm add @opentelemetry/exporter-trace-otlp-proto
pnpm add @opentelemetry/exporter-metrics-otlp-proto
pnpm add @opentelemetry/instrumentation-http
pnpm add @opentelemetry/instrumentation-undici
pnpm add @opentelemetry/instrumentation-pg
```

OpenTelemetry muss vor dem Laden der Nitro-Anwendung initialisiert werden. Die
Plattformseite verwendet den bestehenden BaSyx-Stack:

- OpenTelemetry Collector
- Prometheus
- Tempo
- Loki
- Grafana Alloy
- Grafana

Sobald ein Compose-Observability-Profil eingecheckt ist:

```bash
docker compose --profile observability up -d
docker compose --profile observability ps
```

Telemetry ist nach validierter Startup-Konfiguration fail-open. Collector-Ausfall
darf weder AAS-Requests noch Package-Saves oder App-Ausführung blockieren.
Browser-Telemetry gehört nicht zum ersten Increment; Desktop-Telemetry ist
standardmäßig deaktiviert.

### 5.7 Testabhängigkeiten hinzufügen

```bash
pnpm add -D vitest @vue/test-utils @nuxt/test-utils happy-dom
pnpm add -D @playwright/test testcontainers
pnpm exec playwright install
```

Die Testpyramide muss mindestens enthalten:

- Unit-/Component-Tests mit Vitest, Vue Test Utils und Nuxt Test Utils
- Hosted- und Electron-relevante Browser-Flows mit Playwright
- Integrationstests mit Testcontainers für PostgreSQL
- einen standardsbasierten OIDC-Test-Provider; Keycloak ist Referenz, aber die
  Anwendung bleibt generisch OIDC-kompatibel
- qualifizierte BaSyx-Testtargets für Repository, Registry, Discovery und Copy
- AASX-Golden-Corpus und semantische Round-Trip-Vergleiche
- Contract-Tests für Studio SDK, Capability RPC, lokale Target API, App-Manifeste
  und deklarative View-Schemas

### 5.8 App-Plattform und grafische Views

Die App-Plattform benötigt außerhalb des Studio-Prozesses:

- getrennten/opaquen UI-App-Origin mit sandboxed Iframes
- Deno-Evaluationsruntime für Standard-Backend-Apps
- pro App/Version isolierte, begrenzte Hosted-Runner
- OCI-Registry für immutable Artifacts
- Cosign/Sigstore-kompatible Signaturen und Attestierungen
- `pnpm-lock.yaml` für App-Builds
- CycloneDX- oder SPDX-SBOM
- isolierte Build-, Scan- und Review-Pipeline

Runtime-Installationen oder `pnpm add` in einer installierten App oder im Studio
Service sind verboten. Dependencies werden ausschließlich mit PNPM beim
isolierten Build gelockt, gescannt und in ein unveränderliches Artifact
gebündelt. App-Quellen dürfen npm-Pakete als Ökosystemabhängigkeiten deklarieren,
aber npm, Yarn, Bun oder andere Package Manager werden nicht ausgeführt.

Für grafische Views sind Ajv/JSON Schema und der vorhandene Studio-Stack die
Baseline. Keine große Layout-, Drag-and-drop- oder Low-code-Library vorab
installieren. Ein Kandidat muss zuerst Tastaturbedienbarkeit, responsive Layouts,
stabile Serialisierung, Vue/Nuxt-Kompatibilität, Bundle-Kosten und den tatsächlich
entfallenden Studio-Code in einem vertikalen Slice beweisen.

## 6. Tägliches Setup nach vorhandenem Bootstrap

Sobald `package.json`, `pnpm-lock.yaml` und die zugehörigen Skripte eingecheckt sind:

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm dev
```

Production Build und lokale Vorschau:

```bash
pnpm build
pnpm preview
```

Erwartete Skripte für die Desktop-Entwicklung, sobald implementiert:

```bash
pnpm dev:electron
pnpm build:electron
```

Erwartete Qualitätsprüfungen:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Diese Namen sind ein Ziel für das Bootstrap. Vorher immer mit folgendem Befehl
prüfen, welche Skripte tatsächlich vorhanden sind:

```bash
pnpm run
```

## 7. Lokale Infrastruktur pro Use Case starten

Die folgenden Befehle setzen künftig eingecheckte, validierte Compose-Profile
voraus. Bis diese Dateien existieren, dürfen sie nicht als funktionsfähiger
Ist-Zustand dokumentiert oder in CI verwendet werden.

### 7.1 Hosted Studio mit Live AAS

```bash
docker compose --profile hosted-live up -d
docker compose --profile hosted-live ps
pnpm dev
```

Das Profil soll enthalten:

- PostgreSQL mit Studio-eigenem Schema/User
- standardsbasierten OIDC-Test-Provider
- mindestens eine BaSyx-Go-Testinfrastruktur
- optional eine zweite, unabhängig authentifizierte Infrastruktur für
  Target-Switching und Cross-Target-Copy
- optional das gemeinsame Observability-Profil

### 7.2 Desktop Studio mit Live AAS

```bash
docker compose --profile desktop-live up -d
pnpm dev:electron
```

Die Desktop-App verbindet sich über ihren lokalen BFF zu Internet-,
Private-Network- oder localhost/Docker-Targets. Private-/Loopback-Adressen müssen
explizit erlaubt werden; SSRF-, Redirect-, Timeout- und Response-Limits bleiben
trotzdem aktiv.

### 7.3 Desktop Studio mit lokalem AASX

```bash
pnpm dev:electron
```

Für diesen Use Case ist kein BaSyx-Server erforderlich. Der Renderer darf keine
freien Dateipfade erhalten. Native Dialoge liefern eingeschränkte Handles; der
Workspace Worker übernimmt Import, Validierung, Revisionen, Recovery und
atomisches Speichern.

### 7.4 App-Plattform

```bash
docker compose --profile apps up -d
docker compose --profile apps ps
```

Das Profil soll Registry, Test-Catalogue, isolierte Runner und die benötigte
Signatur-/Verifikationskette enthalten. App-Assets müssen von einem anderen
Origin als die Studio UI geladen werden.

### 7.5 Observability

```bash
docker compose --profile observability up -d
docker compose --profile observability ps
```

Studio, App Runner und BaSyx Go senden OTLP/HTTP an den Collector; JSON-Logs gehen
nach `stderr` und werden von Alloy übernommen. Tempo ist das Trace-Backend. Kein
zusätzlicher Jaeger-Stack ist erforderlich.

## 8. Konfiguration und Secrets

Die konkreten Variablennamen müssen von der späteren, mit Zod validierten
Konfigurationsschicht vorgegeben und in einer `.env.example` dokumentiert werden.
Bis dahin sind keine erfundenen Environment-Variablen verbindlich.

Folgende Konfigurationsgruppen sind erforderlich:

- öffentliche Studio-Basis-URL und serverseitige Session-/Cookie-Einstellungen
- PostgreSQL-Verbindung beziehungsweise SQLite-Dateipfad
- Secret-Manager-/Keychain-Integration
- OIDC Discovery, Client-ID, Redirect URI und serverseitiges Client Secret
- pro AAS-Target opaque ID, erlaubte Endpunkte, Auth-Strategie und
  Capability-/Metamodell-Metadaten
- Outbound-Allowlist, Scheme-/Port-/Private-Network-Policy, Timeouts,
  Redirect- und Größenlimits
- OTLP-Endpunkt und begrenzte Service-Resource-Attribute
- Marketplace-/OCI-/Signatur-Vertrauensanker
- Desktop-Update-Channel und Signaturmetadaten

Regeln:

- Lokale Secrets nur in nicht versionierten `.env`-Dateien oder im OS-Keychain
- Produktions-Secrets ausschließlich über den Deployment Secret Manager
- keine Tokens, Cookies, Client Secrets, DB-DSNs oder Dateipfade in öffentlicher
  Nuxt-Runtime-Konfiguration
- keine Secrets, Authorization Header, Request-/Response-Bodies oder AASX-Inhalte
  in Logs, Traces oder Metriken
- committed wird nur eine secret-freie `.env.example`

## 9. Setup verifizieren

### 9.1 Statische und Build-Prüfungen

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### 9.2 Hosted-Live-Smoke-Test

Prüfen, dass:

1. Login über Authorization Code + PKCE funktioniert.
2. Der Browser nur ein Secure-/HttpOnly-Session-Cookie und keine Downstream-Tokens
   erhält.
3. Mindestens zwei Targets getrennte Sessions, Credentials und Cache-Namespaces
   behalten.
4. SDK-basierte Repository-/Registry-/Discovery-Abfragen funktionieren.
5. Target-Wechsel keine Daten oder Drafts in das andere Target leakt.
6. Cross-Target-Copy erst einen Plan zeigt, die Quelle unverändert lässt und
   partielle Ergebnisse korrekt ausweist.

### 9.3 Desktop-Live-Smoke-Test

Prüfen, dass:

1. Electron den lokalen Studio Service auf einem zufälligen Loopback-Port startet.
2. Renderer-Sandbox, Context Isolation und minimale validierte IPC aktiv sind.
3. OIDC den Systembrowser nutzt und Secrets im OS-geschützten Store bleiben.
4. localhost/Docker- und Remote-Targets nur über den lokalen BFF erreichbar sind.

### 9.4 Desktop-AASX-Smoke-Test

Prüfen, dass:

1. Öffnen/Speichern nur über native, eingeschränkte File-/Workspace-Handles läuft.
2. Malformed Archives, Path Traversal, absolute Pfade, Decompression Bombs,
   Größen-/Entry-Limits und Timeouts abgewehrt werden.
3. Import, Bearbeitung, atomischer Save, Reopen und AAS-Core-Validierung den
   Golden-Corpus bestehen.
4. Ein Konflikt die Nutzerdraft erhält und eine strukturierte Revision meldet.

### 9.5 Apps/Views-Smoke-Test

Prüfen, dass:

1. Digest, Signatur, Kompatibilität, Revocation und Permissions vor Aktivierung
   geprüft werden.
2. UI-Apps/-Widgets cross-origin sandboxed bleiben.
3. Backend-Apps außerhalb des Studio Service mit Deny-by-default-Rechten laufen.
4. Capability Calls pro App, User, Target und Operation autorisiert/auditiert
   werden und niemals Infrastruktur-Tokens liefern.
5. View-Definitionen rein deklarativ sind und fehlende Apps/Bindings nur das
   betroffene Widget degradieren.

### 9.6 Observability-Smoke-Test

Prüfen, dass:

1. `traceparent`, `tracestate`, `X-Request-ID` und `X-Correlation-ID` bis zu
   BaSyx Go propagiert werden.
2. Requests, PostgreSQL Pool, Copy-, View- und App-Operationen begrenzte Signale
   erzeugen.
3. Nutzer-, Workspace-, Shell-, Submodel- oder Package-IDs keine unbeschränkten
   Metriklabels werden.
4. Collector-Ausfall keine Produktoperation blockiert.

## 10. Dependency-Gates und bewusst nicht installierte Komponenten

| Komponente | Status | Aufnahmebedingung |
| --- | --- | --- |
| Drizzle | Kandidat | Migrationen, Locking, beide DBs und Electron-Packaging im Slice beweisen |
| Graphile Worker/andere PostgreSQL Queue | Kandidat | Konkrete Retry-/Concurrency-/Durability-Anforderung |
| AASX Package Engine | Offen | Golden Round Trip, Sicherheit, Recovery und Cross-Platform-Packaging bestehen |
| Layout-/Drag-and-drop-Library | Offen | Accessibility, Serialisierung, Bundle-Kosten und vermiedenen Code beweisen |
| Deno Backend Runtime | Bevorzugte Evaluation | Deny-by-default plus Prozess-/Container-Isolation praktisch qualifizieren |
| Redis/Broker | Nicht Baseline | Gemessene Skalierungs-/Durability-Lücke und neuer ADR |
| Kubernetes/Service Mesh | Nicht Baseline | Gemessener Hosted-Scale-Bedarf und neuer ADR |
| WebSockets | Nicht Standard | Dokumentierter bidirektionaler Use Case samt Protokoll-/Betriebsregeln |
| Browser OpenTelemetry | Zurückgestellt | Datenschutz- und Operational-Value-Entscheidung |

Jede neue große Dependency, Runtime, Datenbank oder jeder neue Service muss den
entfallenden Code beziehungsweise das reduzierte Risiko, Alternativen,
Transitives, Lizenz, Wartung, Security-Historie, Betriebsaufwand und Exit-Strategie
dokumentieren. Eine cross-cutting Änderung benötigt einen neuen oder
supersedierenden ADR.

## 11. Definition of Done für ein vollständiges Setup

Das Projekt gilt technisch als vollständig aufgesetzt, wenn:

- `package.json`, `pnpm-lock.yaml`, reproduzierbare PNPM-Skripte und eine
  secret-freie `.env.example` vorhanden sind;
- Hosted Studio mit PostgreSQL, OIDC und mindestens einem BaSyx-Testtarget startet;
- Electron denselben UI-/API-Pfad mit gehärtetem lokalen BFF startet;
- der qualifizierte Workspace Worker einen AASX-Golden-Corpus sicher verarbeitet;
- App-Artefakte isoliert gebaut, signiert, geprüft und ausgeführt werden können;
- Views deklarativ gespeichert und über denselben Capability-/Target-Pfad
  gerendert werden;
- Lint, Typecheck, Tests, Build, Integrations-, Security- und N−2-Migrationstests
  erfolgreich sind;
- Logs, Traces und Metriken mit dem BaSyx-Grafana-Stack korrelieren, ohne Secrets
  oder unbeschränkte fachliche Identifikatoren zu erfassen.

Bis diese Artefakte implementiert und eingecheckt sind, ist dieses Dokument der
Setup-Plan der Zielarchitektur und keine Behauptung, dass der aktuelle
Docs-only-Stand bereits ausführbar ist.
