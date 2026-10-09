# Endpunktübersicht: Frontend ↔ BFF

Die vollständige maschinenlesbare Definition steht in
[openapi.yaml](openapi.yaml). Dieses Dokument erklärt die Endpunkte auf
Funktionsebene, ohne die OpenAPI-Schemas zu duplizieren.

## Gemeinsame Regeln

- Basis: `/api/studio/v1`; derselbe Vertrag gilt für Browser und Electron.
- Die Session ist ein opaker, serverseitiger HttpOnly-Cookie. OAuth-Tokens und
  Downstream-Credentials erreichen nie das Frontend.
- Jede fachliche Target-Anfrage enthält ein opakes `targetId`. Das Frontend
  sendet keine BaSyx-Service-URL als Routing-Entscheidung.
- Mutationen benötigen `X-CSRF-Token`; revisionsgeschützte Mutationen zusätzlich
  `If-Match`. Antworten liefern die neue Revision als `ETag`.
- Listen verwenden `limit` und einen opaken `cursor`.
- Wiederholbare Commands verwenden `Idempotency-Key`.
- Längere Abläufe liefern `202 Accepted` und eine Operation-Ressource. Fortschritt
  kann per SSE oder ersatzweise durch Polling abgefragt werden.
- Fehler verwenden `application/problem+json` mit stabilem `code`,
  `requestId`, `correlationId` und `retryable`.

## Context und Anmeldung

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /context` | Liefert Deployment-Modus, API-/Studio-Version, verfügbare Plattformfunktionen und den Session-Kontext für den UI-Start. Kann anonym aufgerufen werden. |
| `GET /session` | Liefert angemeldeten Benutzer, Gruppen/Rollen, CSRF-Wert, aktives Target und Session-Ablauf. |
| `POST /auth/login` | Startet OIDC Authorization Code mit PKCE. Antwort enthält nur eine validierte Navigations-URL. |
| `GET /auth/callback` | Nimmt den OIDC-Code entgegen; BFF prüft State/Nonce, tauscht serverseitig Tokens und setzt/resumiert die Session. Gilt auch für Target-Reauth. |
| `POST /auth/logout` | Beendet die Studio-Session und serverseitige Target-Kontexte. |

## Targets und Infrastrukturen

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /targets` | Listet sichtbare Live-Infrastrukturen und lokale AASX-Workspaces samt Status, Capabilities und Berechtigungen. |
| `GET /targets/{targetId}` | Liefert Detailstatus eines Targets; Credentials und unsichere interne Details bleiben verborgen. |
| `PUT /targets/{targetId}/activation` | Prüft Rechte/Health und setzt das aktive Target der Session. Die Entscheidung über ungespeicherte UI-Drafts kommt im Request aus dem Frontend. |
| `POST /targets/{targetId}/authorization` | Startet oder resumiert die Authentifizierung genau dieses Targets. Andere Target-Sessions bleiben unverändert. |
| `DELETE /targets/{targetId}/authorization` | Trennt nur den Credential-Kontext dieses Targets. |
| `GET /infrastructures` | Listet administrativ verwaltete Live-Infrastrukturen. |
| `POST /infrastructures` | Nimmt eine Admin-Konfiguration an, validiert SSRF-/Netzwerkregeln, führt einen Probe aus und registriert sie erst danach. Secrets werden nur als Secret-Referenz verarbeitet. |
| `GET /infrastructures/{targetId}` | Liefert sanitisierte Konfigurationsdetails und Endpoint-Rollen. |
| `PATCH /infrastructures/{targetId}` | Ändert Konfiguration mit `If-Match`, erneuter Validierung und Probe. |
| `DELETE /infrastructures/{targetId}` | Entfernt die Studio-Konfiguration, nicht die Daten der Infrastruktur. |
| `POST /infrastructures/{targetId}/probe` | Aktualisiert Health, erkannte Services, Metamodellversionen und Capabilities. |

## AAS- und Target-Daten

Alle folgenden Pfade sind unter `/targets/{targetId}` scoped. Der BFF wählt
serverseitig den BaSyx-TypeScript-SDK-Client oder den Workspace Worker.

| Methode und Pfad | Zweck |
| --- | --- |
| `GET/POST /targets/{targetId}/shells` | Shells auflisten bzw. validiert anlegen. |
| `GET/PUT/DELETE /targets/{targetId}/shells/{resourceKey}` | Shell lesen, mit `If-Match` ersetzen oder löschen. |
| `GET/POST /targets/{targetId}/submodels` | Submodelle auflisten bzw. anlegen. |
| `GET/PUT/DELETE /targets/{targetId}/submodels/{resourceKey}` | Submodell lesen, ersetzen oder löschen. |
| `GET/POST /targets/{targetId}/submodels/{resourceKey}/elements` | Kindelemente auflisten bzw. ein Element anlegen. |
| `GET/PUT/DELETE /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}` | Einzelnes Element lesen, ersetzen oder löschen. |
| `GET/POST /targets/{targetId}/concept-descriptions` | Concept Descriptions auflisten bzw. – wenn vom Target unterstützt – anlegen. |
| `GET/PUT/DELETE /targets/{targetId}/concept-descriptions/{resourceKey}` | Concept Description lesen, ersetzen oder löschen. |
| `POST /targets/{targetId}/operation-invocations` | Eine explizit ausgewählte AAS-Operation mit validierten Inputs und ggf. Bestätigung ausführen. |
| `GET/POST /targets/{targetId}/files` | Supplementary-File-Metadaten auflisten bzw. einen begrenzten Upload streamen. |
| `GET/DELETE /targets/{targetId}/files/{fileKey}` | Datei begrenzt streamen bzw. löschen. Es werden keine lokalen Pfade zurückgegeben. |
| `GET /targets/{targetId}/semantic-index` | Semantische Fakten für Shell-/Submodell-Auswahl, Bindings und App-Anwendbarkeit suchen. |

AAS-Modelle bleiben im Vertrag absichtlich generisch: Validierung erfolgt mit
den autoritativen AAS-Core-3.1-Typen und Package-Validatoren, nicht mit einer
zweiten Studio-Metamodell-Spezifikation.

## Desktop-Workspaces und AASX

Native Datei-/Ordnerdialoge gehören zum Electron-IPC-Vertrag. Der BFF sieht nur
kurzlebige opake Handles.

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /workspaces` | Listet lokale Projekte, niemals native Pfade. Nur bei Desktop-Capability verfügbar. |
| `POST /workspaces` | Erstellt ein Projekt an einem freigegebenen Ziel-Handle. |
| `POST /workspaces/imports` | Importiert ein AASX über den Workspace Worker; Archivgröße, Pfade, Entry-Anzahl, MIME und Ressourcenlimits werden geprüft. |
| `GET/PATCH/DELETE /workspaces/{workspaceId}` | Metadaten, Recovery-/Validierungsstatus lesen, Metadaten ändern oder Projekt löschen. Datei-Löschung ist eine explizite Option. |
| `PUT /workspaces/{workspaceId}/activation` | Öffnet das Projekt und stellt es als lokales `AasTarget` bereit. |
| `POST /workspaces/{workspaceId}/duplications` | Dupliziert das Projekt an ein freigegebenes Ziel-Handle. |
| `POST /workspaces/{workspaceId}/saves` | Speichert die aktuelle Revision atomar in das Paket. |
| `POST /workspaces/{workspaceId}/exports` | Exportiert die validierte Revision atomar an ein freigegebenes Ziel-Handle. |

Nach dem Öffnen laufen AAS-Reads und -Mutationen über die normalen
`/targets/{targetId}/...`-Endpunkte.

Stand MVP-2: Implementiert sind `POST /workspaces` (öffnet ein AASX aus einem
Datei-Handle), `POST /workspaces/{workspaceId}/saves`,
`POST /workspaces/{workspaceId}/exports` (Speichern unter) und
`DELETE /workspaces/{workspaceId}?force=`. Datei-Handles stellt nur der
Electron-Main-Prozess über `POST /desktop/file-grants` aus
([ADR 0015](../adr/0015-desktop-native-bridge-and-file-grants.md)); Details und
Abweichungen stehen im [MVP-2-Plan](../development/mvp-2-plan.md#results).

## Cross-Target-Copy

| Methode und Pfad | Zweck |
| --- | --- |
| `POST /copy-plans` | Erstellt einen read-only Preflight-Plan mit Quell-/Zielrechten, Capabilities, Dependency Closure, Kollisionen, Findings, Größenabschätzung und Aktionen. |
| `GET /copy-plans/{copyPlanId}` | Liest den versionierten, ablaufenden Plan erneut. |
| `POST /copy-plans/{copyPlanId}/executions` | Bestätigt Policy und sichtbare Konsequenzen; startet die Ausführung idempotent als Operation. Quelle bleibt unverändert, Atomarität wird nicht behauptet. |
| `GET /copy-operations/{operationId}/report` | Liefert pro Ressource `created`, `skipped`, `replaced` oder `failed`, einschließlich Validierung und Partial-Success. |
| `POST /copy-operations/{operationId}/retries` | Wiederholt nur sichere, fehlgeschlagene/incomplete Ressourcen. |

Die Standard-Collision-Policy ist `fail_without_changes`; `skip_existing` und
`replace` sind nur bei Capability und Berechtigung zulässig.

## Views, Widgets und Bindings

| Methode und Pfad | Zweck |
| --- | --- |
| `GET/POST /views` | Sichtbare Views auflisten bzw. eine deklarative View validiert speichern. |
| `GET/PUT/DELETE /views/{viewId}` | View laden, revisionsgeschützt ersetzen oder löschen. |
| `POST /views/validations` | Ungespeicherten Entwurf inklusive Bindings und Widget-Kompatibilität prüfen. |
| `POST /views/imports` / `GET /views/{viewId}/export` | Portable Definition importieren bzw. ohne Apps, Secrets oder AAS-Werte exportieren. |
| `GET/PUT /views/{viewId}/access-rules` | View-Öffnen und View-Autorisierung getrennt verwalten. |
| `POST /views/{viewId}/runtime-contexts` | Definition migrieren, Widgets autorisieren und alle Bindings im aktiven Kontext auflösen. Einzelne defekte Widgets werden als Diagnostics geliefert. |
| `POST /binding-resolutions` | Eine vorgeschlagene Instance- oder Semantic-Bindung auflösen. Status: `resolved`, `ambiguous`, `missing`, `incompatible`, `unauthorized`. |
| `POST /binding-executions` | Einen konkreten, autorisierten Binding-Read, -Write oder Operationsaufruf ausführen. View-Öffnen allein verleiht keine Datenrechte. |
| `GET /widget-types` | Für Target/Kontext erlaubte Built-in- und App-Widgets samt Schema, Slots, Compatibility, Applicability und Permissions liefern. |

View-Definitionen sind deklarative Daten; JavaScript, Vue, HTML, Credentials,
Service-URLs und Dateisystempfade sind ausgeschlossen.

## Apps

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /apps/catalog` | Sanitisierte Marketplace-Projektion für die UI, inklusive Compatibility und Applicability. |
| `GET /apps/catalog/{appId}/versions/{version}` | Immutable Version mit Digest, Signatur-/Revocation-Status, SBOM-/Review-Informationen und angeforderten Capabilities. |
| `GET/POST /app-installations` | Installationen anzeigen bzw. digest-gepinnt und mit expliziten Permissions installieren. Installation läuft asynchron; ein Developer-Mode-Paket (`application/zip`) wird synchron geprüft und installiert (MVP-3). |
| `GET/DELETE /app-installations/{installationId}` | Lifecycle und Berechtigungen anzeigen bzw. Installation entfernen. |
| `GET /app-installations/{installationId}/compatibility` | Technische Compatibility und semantische Applicability getrennt bewerten. |
| `GET /app-contributions` | Module der installierten Apps und, für eine Semantic ID, passende Submodell-Views mit Begründung (MVP-3). |
| `POST /app-calls` | Capability-Aufruf für eine App: von der Host-Bridge per Session oder vom Backend per kurzlebigem Capability-Token; geprüft gegen Manifest und Benutzerrechte (MVP-3, ADR 0018). |
| `POST/DELETE /app-installations/{installationId}/activations` | Für Target/Kontext aktivieren bzw. deaktivieren. |
| `POST /app-installations/{installationId}/updates` | Signierte immutable Version prüfen und als Update bereitstellen. |
| `POST /app-installations/{installationId}/rollbacks` | Auf eine verifizierte vorherige Version zurückrollen. |
| `GET/PUT /app-installations/{installationId}/visibility` | Sichtbarkeit für Benutzer/Gruppen unabhängig von Installationsscope verwalten. |

App-`postMessage`-/Capability-RPC und App-Runner-Kommunikation sind ein eigener
Vertrag; diese Endpunkte verwalten nur den BFF-seitigen App-Lifecycle.

## Operations, Events und Audit

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /operations` | Begrenzte Liste laufender oder abgeschlossener Copy-/App-Operationen für Polling. |
| `GET /operations/{operationId}` | Einzelnen Status, Fortschritt, Fehler und Links abfragen. |
| `GET /operations/{operationId}/events` | Einseitiger SSE-Stream für Progress und Outcomes; Resume über `Last-Event-ID`. |
| `GET /events` | Topic-gefilterte SSE-Notifications und Cache-Invalidierungen; kein Command-Kanal. |
| `GET /audit-events` | Autorisierte, sanitisierte Audit-Zusammenfassungen. Keine Tokens, Bodies, Paket-Inhalte oder Secrets. |

## Nicht Teil dieser API

Electron-IPC, Workspace-Worker-API, App-SDK-RPC, Marketplace-Publisher-/OCI-
API, OIDC-Provider-API, BaSyx-Downstream-API und der Desktop-Updater bleiben
separate Verträge. Dadurch bleiben die im Architektur- und Security-Teil der
Dokumentation beschriebenen Trust Boundaries erhalten.
