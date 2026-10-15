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
| `GET/PUT /me/preferences` | Einstellungen des angemeldeten Benutzers lesen bzw. ersetzen: zuletzt geöffnete Shells (`{ key, title }`) je Target, Theme, Sprache mehrsprachiger Werte, Auto-Refresh und `syncOverrides` je Infrastruktur (MVP-4). |

## Targets und Infrastrukturen

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /targets` | Listet sichtbare Live-Infrastrukturen und lokale AASX-Workspaces samt Status, Capabilities und Berechtigungen. |
| `GET /targets/{targetId}` | Liefert Detailstatus eines Targets; Credentials und unsichere interne Details bleiben verborgen. Capabilities (u. a. `search`, `queryTarget`, `elementSearch`, `listSource`) folgen aus den gespeicherten Service-Profilen ([ADR 0021](../adr/0021-feature-detection-from-service-profiles.md)); `registrySync` nennt Sync-Default und Benutzer-Override, sofern Studio Registries und Discovery nachzieht. |
| `PUT /targets/{targetId}/activation` | Prüft Rechte/Health und setzt das aktive Target der Session. Die Entscheidung über ungespeicherte UI-Drafts kommt im Request aus dem Frontend. |
| `POST /targets/{targetId}/authorization` | Startet oder resumiert die Authentifizierung genau dieses Targets. Andere Target-Sessions bleiben unverändert. |
| `DELETE /targets/{targetId}/authorization` | Trennt nur den Credential-Kontext dieses Targets. |
| `GET /infrastructures` | Listet administrativ verwaltete Live-Infrastrukturen. |
| `POST /infrastructures` | Nimmt eine Admin-Konfiguration an (Template, Endpoints, `listSource`, `sync`, Security), validiert Template- und SSRF-/Netzwerkregeln sowie ein optionales Client-Zertifikat (`clientCertificate`, PKCS#12), führt einen Probe aus und registriert sie erst danach. Secrets und Zertifikate werden gehostet nur als Referenz verarbeitet; der Desktop speichert hochgeladene Werte verschlüsselt. |
| `GET /infrastructures/{infrastructureId}` | Liefert sanitisierte Konfigurationsdetails, Endpoints, Service-Profile (`serviceProfiles`, `probedAt`, `announced`) und Revision. |
| `PUT /infrastructures/{infrastructureId}` | Ersetzt die Konfiguration mit `If-Match`, erneuter Validierung und Probe. Ein weggelassenes `clientCertificate` bleibt erhalten, `null` entfernt es. |
| `DELETE /infrastructures/{infrastructureId}` | Entfernt die Studio-Konfiguration, nicht die Daten der Infrastruktur. |
| `POST /infrastructures/{infrastructureId}/probe` | Fragt `/description` jedes Endpoints erneut ab, liefert Erreichbarkeit und Profile je Endpoint und ersetzt die gespeicherten Profile. |

## AAS- und Target-Daten

Alle folgenden Pfade sind unter `/targets/{targetId}` scoped. Der BFF wählt
serverseitig den BaSyx-TypeScript-SDK-Client oder den Workspace Worker.

| Methode und Pfad | Zweck |
| --- | --- |
| `GET/POST /targets/{targetId}/shells` | Shells aus der Listenquelle (AAS-Registry oder -Repository) cursor-basiert auflisten bzw. validiert anlegen. |
| `POST /targets/{targetId}/shell-availability` | Für bis zu 50 Shell-Keys melden, ob die Shell geöffnet werden kann: `available`, `forbidden`, `not_found`, `blocked` (Descriptor-Endpoint außerhalb der Infrastruktur) oder `unreachable`. |
| `POST /targets/{targetId}/searches` | Shells per Suchausdruck (`expression`) oder AAS-Query (`query`) cursor-basiert suchen, oder Submodell-Elemente per Text (`scope: elements`). Ungültige Queries ergeben `query_invalid` mit `violations`, fehlende Query-Unterstützung `query_unsupported`. |
| `GET /targets/{targetId}/lookup` | Shells eines Assets über die globale Asset-ID finden: per Discovery, sonst per Query auf dem AAS-Repository, wo es Queries ankündigt. |
| `GET/PUT/DELETE /targets/{targetId}/shells/{shellKey}` | Shell lesen, mit `If-Match` ersetzen oder löschen. Das Löschen liefert die Registry- und Discovery-Schritte, die Studio danach ausgeführt hat (`sync`). |
| `GET /targets/{targetId}/shells/{shellKey}/submodel-refs` | Referenzierte Submodelle mit Status (`available`, `forbidden`, `not_found`, `blocked`, `error`). |
| `GET /targets/{targetId}/shells/{shellKey}/thumbnail` | Thumbnail der Shell streamen; `204`, wenn sie keines hat. |
| `GET /targets/{targetId}/shells/{shellKey}/export` | Shell mit Submodellen und Concept Descriptions als AASX, JSON oder XML herunterladen. |
| `GET /targets/{targetId}/shells/{shellKey}/rights` | Effektive Rechte des angemeldeten Benutzers auf der Shell, damit die UI unzulässige Aktionen ausblendet. |
| `GET/PUT /targets/{targetId}/shells/{shellKey}/access` | ReBAC-Freigaben einer Shell lesen bzw. mit `If-Match` ersetzen. |
| `POST /targets/{targetId}/shells/{shellKey}/access/invitations` | Einladung erzeugen, die eine Relation auf der Shell gewährt. |
| `POST /targets/{targetId}/invitations` | Einladung für den angemeldeten Benutzer annehmen. |
| `GET/POST /targets/{targetId}/submodels` | Submodelle auflisten bzw. anlegen. |
| `GET/PUT/DELETE /targets/{targetId}/submodels/{submodelKey}` | Submodell lesen (`content=metadata\|full`, `format=json\|xml`, `at`), ersetzen oder löschen. |
| `GET/POST /targets/{targetId}/submodels/{submodelKey}/elements` | Baumknoten unter dem Submodell oder `parentElementKey` mit so vielen vollständigen Ebenen, wie in `budget` Knoten passen (Standard 2.000, höchstens 5.000), auch historisch mit `at`; bzw. ein Element anlegen. |
| `GET/PUT/DELETE /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}` | Einzelnes Element als JSON mit Revision und `ancestors` oder als AAS-XML lesen (`format`, `at`), ersetzen oder löschen. |
| `POST /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/moves` | Element an eine Position unter seinen Geschwistern verschieben; `If-Match` mit der Strukturrevision des Elternknotens (`structure_conflict` bei gleichzeitiger Strukturänderung). |
| `PUT /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/value` | Wert einer Property oder MultiLanguageProperty mit `If-Match` setzen. |
| `GET/PUT /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/attachment` | Inhalt eines File-Elements streamen bzw. mit `If-Match` ersetzen. |
| `POST /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/invocations` | Eine Operation synchron oder asynchron aufrufen; asynchrone Aufrufe liefern ein Handle. |
| `GET /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}/invocations/{handle}` | Zustand und Outputs eines asynchronen Aufrufs abfragen. |
| `GET/POST /targets/{targetId}/concept-descriptions` | Concept Descriptions auflisten bzw. anlegen (ohne ID erzeugt Studio eine nach dem Schema der Infrastruktur; `identifier_conflict` bei vorhandener ID). |
| `GET/PUT/DELETE /targets/{targetId}/concept-descriptions/{resourceKey}` | Concept Description als JSON mit Revision oder als AAS-XML lesen (`format`), mit `If-Match` ersetzen oder löschen. |
| `GET /targets/{targetId}/concept-descriptions/{resourceKey}/usages` | Submodelle und Elemente zählen, deren Semantic ID die Concept Description nennt (für die Löschbestätigung). |
| `GET /targets/{targetId}/changes` | Änderungsereignisse von Shells, Submodellen und Assets lesen, wo der Server seinen Event-Feed ankündigt. |
| `POST /targets/{targetId}/uploads` | Inhalt einer AASX-, JSON- oder XML-Datei hinzufügen; liefert die neuen Shells und die Registry- und Discovery-Schritte (`sync`). |
| `POST /targets/{targetId}/operation-invocations` | Eine explizit ausgewählte AAS-Operation mit validierten Inputs und ggf. Bestätigung ausführen. |
| `GET/POST /targets/{targetId}/files` | Supplementary-File-Metadaten auflisten bzw. einen begrenzten Upload streamen. |
| `GET/DELETE /targets/{targetId}/files/{fileKey}` | Datei begrenzt streamen bzw. löschen. Es werden keine lokalen Pfade zurückgegeben. |
| `GET /targets/{targetId}/semantic-index` | Semantische Fakten für Shell-/Submodell-Auswahl, Bindings und App-Anwendbarkeit suchen. |

AAS-Modelle bleiben im Vertrag absichtlich generisch: Validierung erfolgt mit
den autoritativen AAS-Core-3.1-Typen und Package-Validatoren, nicht mit einer
zweiten Studio-Metamodell-Spezifikation.

Stand MVP-4: Implementiert sind die Shell-Liste, das Lesen einzelner Shells,
Submodelle und Elemente sowie `shell-availability`, `searches`, `lookup`,
`submodel-refs`, `thumbnail`, `export`, `rights`, `access`, Einladungen,
`changes`, `concept-descriptions` (lesend), `uploads`, das Löschen von Shells,
Werte, Attachments und Invocations je Operation-Element. Anlegen und Ersetzen
ganzer Shells, Submodelle, Elemente und Concept Descriptions, die
Submodell-Liste, `operation-invocations`, `files` und `semantic-index` bleiben
Entwurf. Optionale Funktionen (History über `at`, `changes`, Freigaben, Queries)
bietet Studio nur an, wo der Server sie in seinen Service-Profilen ankündigt
([ADR 0021](../adr/0021-feature-detection-from-service-profiles.md)); Suche und
Queries laufen über den BFF
([ADR 0024](../adr/0024-aas-query-language-through-the-bff.md)). Die Routen
`GET /targets/{targetId}/search` und
`GET /targets/{targetId}/submodels/{submodelKey}/tree` des Viewer-Ports sind
durch `POST …/searches` und die Ebenenroute `…/elements` mit Knotenbudget
ersetzt. Nach Uploads und Löschungen schreibt bzw. entfernt Studio
Registry-Descriptoren und Discovery-Asset-Links, wo der Server sie nicht selbst
pflegt und der wirksame Sync-Modus `autoCreate` ist
([ADR 0020](../adr/0020-infrastructure-templates-registries-and-sync.md)).
Neue Problem-Codes: `descriptor_endpoint_blocked`, `query_invalid` und
`query_unsupported`. Details stehen im
[MVP-4-Plan](../development/mvp-4-plan.md#studio-api).

Stand MVP-6: Concept Descriptions werden angelegt, ersetzt und gelöscht, auf
Live-Targets wie in Workspaces, geprüft mit AAS Core und mit denselben
Revisionen wie Submodelle; `validations` nimmt auch `conceptDescription`.
Shells, Submodelle und Elemente schreiben ihre `embeddedDataSpecifications`
(IEC 61360) mit den bestehenden Routen. Details stehen im
[MVP-6-Plan](../development/mvp-6-plan.md#implementation-status).

Infrastrukturen können ein TLS-Client-Zertifikat (mTLS) haben, unabhängig vom
Zugriffsmodus ([ADR 0025](../adr/0025-client-certificates-for-infrastructures.md)).
Der Studio Service präsentiert es bei jedem HTTPS-Request an die Endpoints und
an den IdP. Die API liefert nur Subject, Issuer, Ablaufdatum und gegebenenfalls
die Referenz, nie Bundle, Schlüssel oder Passphrase. Neue Problem-Codes:
`target_client_certificate_required`, `target_client_certificate_rejected` und
`client_certificate_invalid`.

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
| `GET/DELETE /app-installations/{installationId}` | Lifecycle und Berechtigungen anzeigen bzw. Installation entfernen. Mit Studio ausgelieferte Apps (`bundled`, ADR 0023) lassen sich nicht entfernen (MVP-4). |
| `GET /app-installations/{installationId}/compatibility` | Technische Compatibility und semantische Applicability getrennt bewerten. |
| `GET /app-contributions` | Module der installierten Apps und, für eine oder mehrere Semantic IDs (wiederholter Parameter, MVP-4), passende Submodell-Views mit Begründung (MVP-3). |
| `POST /app-calls` | Capability-Aufruf für eine App: von der Host-Bridge per Session oder vom Backend per kurzlebigem Capability-Token; geprüft gegen Manifest und Benutzerrechte (MVP-3, ADR 0018). MVP-4 ergänzt `shellId`, `studio.ui.setHeight` und `studio.ui.openFile`; der App-Kontext nennt den Modus (`view` oder `edit`). |
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

## Stand MVP-5: Editor

Strukturelle Schreibzugriffe nutzen Strukturrevisionen (`s.<hash>`, ADR 0027)
und ganze Ressourcen. Zusätzlich zu den oben genannten Routen sind
implementiert:

| Route | Zweck |
| --- | --- |
| `POST /targets/{targetId}/submodels/{submodelKey}/elements` | Element einfügen (`parentElementKey`, `index`); `If-Match` mit der Strukturrevision des Elternknotens. |
| `PUT/DELETE /targets/{targetId}/submodels/{submodelKey}/elements/{elementKey}` | Element ersetzen (auch Umbenennen) bzw. löschen; `If-Match` mit der Elementrevision. |
| `POST …/elements/{elementKey}/moves` | Element verschieben (Listenelemente; BaSyx Go sortiert benannte Kinder nach Namen). |
| `PUT /targets/{targetId}/submodels/{submodelKey}` | Submodell-Metadaten ersetzen, Elemente bleiben. |
| `POST /targets/{targetId}/shells` | Shell mit neuen Submodellen anlegen (Assistent); Submodelle zuerst, Schritte im Ergebnis. |
| `PUT /targets/{targetId}/shells/{shellKey}` | Shell-Metadaten und Asset-Informationen ersetzen, Submodell-Referenzen bleiben. |
| `PUT /targets/{targetId}/shells/{shellKey}/thumbnail` | Vorschaubild setzen. |
| `POST /targets/{targetId}/shells/{shellKey}/instances` | Instanz aus einem Typ-Shell. |
| `POST/DELETE /targets/{targetId}/shells/{shellKey}/submodel-refs[/{submodelKey}]` | Submodell hinzufügen bzw. entfernen (`deleteSubmodel`). |
| `POST /targets/{targetId}/submodels/{submodelKey}/instance-conversions` | Template in Instanz umwandeln. |
| `GET /targets/{targetId}/templates[/{templateId}]`, `GET /submodel-templates/{templateId}` | Templates und ihre Felder. |
| `POST /targets/{targetId}/validations` | AAS-Core-Befunde für JSON, ohne zu schreiben. |
| `POST /workspaces` mit `{ "empty": true }` | Neues, leeres Paket. |
| `POST /workspaces/{workspaceId}/undos`, `/redos` | Rückgängig / Wiederholen bis Speichern oder Schließen. |

Neue Problem-Codes: `idshort_conflict`, `structure_conflict`,
`identifier_conflict`, `partial_write` (mit `steps`), `template_invalid`.
