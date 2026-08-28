# Studio Frontend API

Dieser Ordner enthält den ersten designorientierten Vertragsentwurf für die
Kommunikation zwischen der Nuxt/Vue-Oberfläche und dem Studio Service/BFF:

- [OpenAPI 3.1 specification](openapi.yaml)

## Status und Autorität

`openapi.yaml` ist `1.0.0-draft.1` und dient als Bootstrap- und
Diskussionsgrundlage, solange noch keine fachlichen Nitro-Routen oder
TypeScript-Vertragsschemas existieren. Sie setzt bewusst die Vorgaben aus den
Requirements, akzeptierten ADRs und Architekturunterlagen vor dem aktuellen
Prototyp um.

Sobald die Implementierung beginnt, muss der Vertrag eine einzige autoritative
Quelle erhalten. Die bevorzugte Zielrichtung ist:

```text
authoritative route/contract schemas
  -> runtime validation
  -> TypeScript DTOs/clients
  -> generated OpenAPI 3.1
```

Die YAML darf dann nicht parallel zu denselben Zod-, Route- oder
TypeScript-DTOs von Hand weitergepflegt werden. Öffentliche View- und
App-Verträge verwenden JSON Schema 2020-12/Ajv; AAS-Daten verwenden generierte
AAS-Core-Typen und AAS-Core-/Package-Validierung.

## Abgedeckter HTTP-Vertrag

Die Spezifikation umfasst alle in `docs/` beschriebenen
Frontend-zu-Studio-BFF-Flächen:

| Bereich | Enthaltene Workflows |
| --- | --- |
| Context und Auth | Deployment-Modus, Session, CSRF, OIDC/PKCE Login, Callback, Logout und getrennte Target-Authentifizierung |
| Targets | sichtbare Live-/AASX-Targets, aktives Target, Health, Metamodell, Capabilities und effektive Rechte |
| Infrastrukturen | administrative Konfiguration, Probe, sanitisierte Details, Security Mode und serverseitige Secret-Referenzen |
| AAS | Shells, Submodels, Elemente, Concept Descriptions, Operations, Supplementary Files und semantischer Index |
| AASX Workspaces | opaque native Handles, Import, Open, Metadaten, Duplikat, Save und Export; Editing läuft über dieselben Target-Routen |
| Cross-Target Copy | Preflight-Plan, Collision Policy, explizite Bestätigung, idempotente Ausführung, Progress, Report und sicherer Retry |
| Views | deklarative Definitionen, Revisionen, ACLs, Import/Export, Widget-Palette, Binding Resolution, Runtime Context und scoped Binding Calls |
| Apps | Catalogue-Projektion, Compatibility/Applicability, Installation, Permission Approval, Visibility, Activation, Update, Rollback und Removal |
| Operations und Events | Polling-Ressourcen, SSE-Fortschritt, Notifications und Cache Invalidation |
| Audit | autorisierte, sanitisierte Audit-Zusammenfassungen für Administration und Operationsdiagnose |

## Bewusste Vertragsgrenzen

Diese OpenAPI beschreibt ausschließlich die versionierte HTTP-/SSE-Kante
zwischen Core UI und Studio Service. Folgende Grenzen bleiben eigene,
versionierte Verträge:

- Electron Preload/IPC für native Dialoge, approved Handles, Updates und die
  lokale Launch-Secret-Injektion;
- App-/Widget-`postMessage` und Capability RPC aus `@basyx/studio-sdk`;
- interne Studio-Service-zu-Workspace-Worker-Kommunikation;
- Marketplace Publisher-, Build-, Signatur-, Catalogue-Storage- und OCI-APIs;
- Studio-BFF-zu-BaSyx-APIs, die ausschließlich über
  `basyx-typescript-sdk` angesprochen werden;
- OIDC-Provider- und Desktop-Update-Service-APIs.

Diese Abgrenzung verhindert, dass Trust Boundaries als vermeintlich einheitliche
Browser-API verschwimmen. Der BFF liefert keine Downstream-Tokens, Secrets,
nativen Pfade oder beliebigen Upstream-URLs.

## Festgelegte Konventionen im Draft

- relative Base URL `/api/studio/v1` für Same-Origin Web und authentifiziertes
  Electron Loopback;
- camelCase Studio-DTOs und opaque, URL-sichere Target-/Resource-Keys;
- Cookie-basierte opaque Studio-Session, kein Browser-Bearer-Scheme;
- verpflichtendes `X-CSRF-Token` plus Same-Origin-Prüfung für Mutationen;
- Cursor-Pagination mit `{ items, page: { nextCursor, hasMore } }`;
- starke `ETag`/`If-Match`-Revisionen; stale Writes ergeben ein strukturiertes
  `412 Precondition Failed` und lassen den UI-Draft unangetastet;
- `Idempotency-Key` für Create-/Copy-/App-Lifecycle-Kommandos;
- `application/problem+json` mit stabilem `code`, `requestId`,
  `correlationId`, `retryable`, optionalen Violations und Revision;
- Target-Authentifizierung erforderlich ist ein typisierter fachlicher
  `409`-Zustand, nicht eine Verwechslung mit fehlender Studio-Session;
- `202 Accepted` plus Operation-Ressource für lange Copy-/App-Abläufe;
- SSE ausschließlich einseitig; `GET /operations/{id}` bleibt Polling-Fallback;
- Cross-Target Copy ist Snapshot-orientiert, lässt die Quelle unverändert und
  gibt weder Atomarität noch Distributed Rollback vor;
- View Definition `1-draft` ist bewusst experimentell und enthält keine
  ausführbaren Inhalte, Credentials, Service-URLs, nativen Pfade oder AAS-Werte.

## Traceability

Operationen tragen `x-requirements` mit den jeweils direkt umgesetzten
Requirement-IDs. Übergreifende Architektur-, Persistenz-, Supply-Chain- und
Observability-Vorgaben stehen als `info.x-design-constraints`, weil sie die
gesamte API prägen und keinen einzelnen Endpoint erzeugen.

| Requirements | Vertragsteil |
| --- | --- |
| `SEC-001` bis `SEC-008`, `DATA-011` | Session, OIDC, Target Auth, Secret-/Netzwerkgrenzen |
| `DATA-001` bis `DATA-009`, `DATA-016`, `PROD-001` bis `PROD-005` | Target-Vertrag, AAS CRUD/Invoke/Files, Revisionen und AASX |
| `PROD-007`, `DATA-012` bis `DATA-015`, `OPS-007` | Copy Plan, Execution, Operation, Report, SSE und Retry |
| `VIEW-001` bis `VIEW-011`, `APP-016`, `PROD-006` | View-, Widget-, Binding- und Runtime-Vertrag |
| `APP-001` bis `APP-014`, `APP-016`, `SEC-006`, `SEC-008` | Catalogue-Projektion und App-Lifecycle; App RPC bleibt separater Vertrag |
| `OPS-004` bis `OPS-007` | IDs, normalisierte Fehler, Audit, Operationen und Events |
| `ARCH-001` bis `ARCH-009` | eine ressourcenorientierte API ohne GraphQL, generischen Proxy, CRUD-WebSockets oder spekulative Services |

Optionale spätere Produktideen werden nicht als bereits verfügbare API
ausgegeben: Developer Mode (`APP-015`), View Templates/Parameter
(`VIEW-012`), Collaborative Editing/Presence (`DATA-010`) und zusätzliche
Broker-/Realtime-Infrastruktur (`OPS-008`).

## Noch zu entscheiden oder durch einen Vertical Slice zu beweisen

- konkrete autoritative AAS-Core-3.1-Schemaeinbindung in die generierte OpenAPI;
- finale Target-/AAS-Identifier-Kodierung hinter den opaque Resource Keys;
- stabilisierte View-Definition nach dem ersten Builder-/Renderer-Vertical-Slice;
- OIDC Return-/Callback-Details für Systembrowser und gehosteten Browser;
- SSE Resume Window, Event Retention und konkrete Deployment-Limits;
- ob die Audit-Read-API bereits im ersten Produktinkrement ausgeliefert wird;
- Auswahl und Pinning eines OpenAPI-3.1-Linters/Generators im PNPM-Tooling.

## Validierung des Erstaufschlags

Der Draft wurde als YAML geparst und mit dem lokal verfügbaren
`openapi-generator validate` strukturell geprüft. Die verbleibenden Hinweise
betreffen nur die über `x-event-schema` dokumentierten SSE-Eventmodelle, die
OpenAPI Generator nicht als normale Response-Model-Referenzen zählt.
