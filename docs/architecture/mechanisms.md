# Important Mechanisms

These are the canonical sequence diagrams for cross-component behavior. The
[deployment variants](deployment-variants.md) define where each participant
runs. Topic documents explain the rules behind the sequences.

## Register a live AAS infrastructure

Infrastructure registration is a Studio administration operation. Secrets are
stored server-side and connectivity is checked before the configuration becomes
available to users.

```mermaid
sequenceDiagram
    actor Admin
    participant UI as Studio UI
    participant BFF as Studio API / BFF
    participant Config as Infrastructure configuration
    participant Secrets as Secret store
    participant SDK as BaSyx TypeScript SDK
    participant AAS as Live AAS infrastructure

    Admin->>UI: Enter endpoints and security mode
    UI->>BFF: Create infrastructure
    BFF->>BFF: Validate configuration and authorization
    BFF->>Secrets: Store credentials or secret references
    BFF->>SDK: Probe required endpoints
    SDK->>AAS: Read service information
    AAS-->>SDK: Capabilities and metamodel version
    SDK-->>BFF: Connectivity result
    BFF->>Config: Store sanitized configuration
    BFF-->>UI: Infrastructure ready
```

## User login and downstream token refresh

The browser receives only an opaque Studio session. OAuth tokens stay in the
Studio Service and are encrypted at rest where persistence is required.

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant BFF as Studio API / BFF
    participant IdP as OIDC provider
    participant Session as Session store

    User->>Browser: Sign in
    Browser->>BFF: Start login
    BFF->>BFF: Create PKCE verifier and state
    BFF-->>Browser: Redirect to authorization endpoint
    Browser->>IdP: Authenticate and consent
    IdP-->>Browser: Authorization code
    Browser->>BFF: Callback with code and state
    BFF->>IdP: Exchange code with PKCE verifier
    IdP-->>BFF: ID, access, and refresh tokens
    BFF->>Session: Store server-side session and tokens
    BFF-->>Browser: Secure, HttpOnly session cookie

    Browser->>BFF: Later Studio API request
    BFF->>Session: Resolve session
    alt Downstream access token expired
        BFF->>IdP: Refresh token grant
        IdP-->>BFF: Rotated tokens
        BFF->>Session: Replace stored tokens
    end
    BFF-->>Browser: Response
```

## Client-credentials access to a live AAS infrastructure

This mode lets a hosted Studio expose a curated catalogue without forwarding
end-user credentials to the AAS provider. Studio still authorizes every user
operation and records who caused it.

```mermaid
sequenceDiagram
    actor User
    participant UI as Studio UI
    participant BFF as Studio API / BFF
    participant Policy as Studio authorization
    participant IdP as AAS identity provider
    participant SDK as BaSyx TypeScript SDK
    participant AAS as Live AAS infrastructure
    participant Audit as Audit store

    User->>UI: Open or modify AAS data
    UI->>BFF: Studio API request
    BFF->>Policy: Authorize user, target, and operation
    Policy-->>BFF: Allowed
    alt No valid deployment access token is cached
        BFF->>IdP: Client credentials grant
        IdP-->>BFF: Deployment access token
    else Valid deployment access token exists
        BFF->>BFF: Reuse server-side cached token
    end
    BFF->>SDK: Execute typed operation with token
    SDK->>AAS: AAS API request
    AAS-->>SDK: Result
    SDK-->>BFF: Typed result
    BFF->>Audit: Record user, target, action, and result
    BFF-->>UI: Sanitized response
```

## Live AAS query or command

The BFF resolves an opaque target ID and invokes the BaSyx TypeScript SDK. The
browser and apps never assemble trusted downstream URLs or handle credentials.

```mermaid
sequenceDiagram
    participant Client as Core UI or installed app
    participant BFF as Studio API / capability broker
    participant Policy as Authorization and capability policy
    participant Router as AAS target router
    participant SDK as BaSyx TypeScript SDK
    participant AAS as Live AAS infrastructure

    Client->>BFF: Query or command with target ID
    BFF->>Policy: Check subject, operation, and resource
    Policy-->>BFF: Allowed capabilities
    BFF->>Router: Resolve target and credential strategy
    Router->>SDK: Call typed SDK operation
    SDK->>AAS: Authenticated AAS API request
    AAS-->>SDK: AAS response
    SDK-->>Router: Typed result or normalized error
    Router-->>BFF: Result with revision metadata
    BFF-->>Client: Studio response
```

## Switch the active target

Target-specific state is discarded or partitioned when users switch between
infrastructures and workspaces. Query keys include the target ID to prevent data
from one target appearing in another.

```mermaid
sequenceDiagram
    actor User
    participant UI as Studio UI
    participant Store as UI state
    participant BFF as Studio API / BFF
    participant Router as AAS target router
    participant Target as Selected AAS target

    User->>UI: Select target
    UI->>Store: Check unsaved drafts
    alt Unsaved changes exist
        Store-->>UI: Require save, discard, or cancel
        User->>UI: Confirm choice
    end
    UI->>BFF: Activate target ID
    BFF->>Router: Resolve and verify target
    Router->>Target: Lightweight health and capability check
    Target-->>Router: Target metadata
    Router-->>BFF: Verified target
    BFF-->>UI: Active target context
    UI->>Store: Clear or partition target-scoped state
    UI->>BFF: Load initial target data
    BFF-->>UI: Shells, capabilities, and permissions
```

## Copy an AAS between authenticated infrastructures

Source and destination are resolved independently. The BFF holds both credential
contexts, builds a preflight plan, and performs a snapshot copy through separate
BaSyx TypeScript SDK clients. The operation does not imply continuous sync or an
atomic transaction across the two infrastructures.

```mermaid
sequenceDiagram
    actor User
    participant UI as Studio UI
    participant BFF as Studio API / copy workflow
    participant Policy as Studio authorization
    participant Auth as Target session and token broker
    participant SourceSDK as Source SDK client
    participant Source as Source AAS infrastructure
    participant DestSDK as Destination SDK client
    participant Dest as Destination AAS infrastructure
    participant Audit as Operation and audit store

    User->>UI: Choose source shell and destination target
    UI->>BFF: Request copy preflight
    BFF->>Policy: Authorize source read and destination inspection
    Policy-->>BFF: Studio-level decision
    par Establish source credentials
        BFF->>Auth: Resolve source target session
        Auth-->>BFF: Source credential context or auth required
    and Establish destination credentials
        BFF->>Auth: Resolve destination target session
        Auth-->>BFF: Destination credential context or auth required
    end
    opt Either target requires interactive authentication
        BFF-->>UI: Authenticate required target
        User->>UI: Complete each required login
        UI->>BFF: Resume preflight
    end
    BFF->>SourceSDK: Read shell and selected dependency closure
    SourceSDK->>Source: Authenticated AAS, submodel, concept and file reads
    Source-->>SourceSDK: Source resources
    SourceSDK-->>BFF: Typed source model and metadata
    BFF->>DestSDK: Inspect capabilities and identifier collisions
    DestSDK->>Dest: Authenticated capability and existence checks
    Dest-->>DestSDK: Destination state
    DestSDK-->>BFF: Typed destination facts
    BFF->>BFF: Validate and build copy plan
    BFF-->>UI: Dependencies, collisions, permissions and actions
    User->>UI: Choose collision policy and confirm
    UI->>BFF: Execute plan with idempotency key
    BFF->>Policy: Reauthorize both targets and planned writes
    BFF->>Audit: Create durable operation record
    loop Each planned destination resource
        BFF->>DestSDK: Create, skip or explicitly replace
        DestSDK->>Dest: Authenticated destination operation
        Dest-->>DestSDK: Resource result
        DestSDK-->>BFF: Normalized result
        BFF->>Audit: Record resource outcome
    end
    BFF->>DestSDK: Re-read and validate copied shell
    DestSDK->>Dest: Read destination result
    Dest-->>DestSDK: Persisted resources
    DestSDK-->>BFF: Validation result
    BFF-->>UI: Complete or partial-success copy report
```

## Author and run a graphical AAS view

The builder persists a declarative definition and uses the same renderer,
binding resolution, authorization, and app sandbox as runtime viewing. App
widgets never become trusted core components.

```mermaid
sequenceDiagram
    actor Author
    actor Viewer
    participant Builder as View builder
    participant Renderer as Shared view renderer
    participant BFF as Studio API / view module
    participant Apps as App and widget registry
    participant Policy as Authorization and capabilities
    participant Router as AAS target router
    participant Target as Active AAS target
    participant AppWidget as Sandboxed app widget
    participant DB as View definition store

    Author->>Builder: Create view in selected AAS context
    Builder->>BFF: List applicable widget types
    BFF->>Apps: Resolve installed, visible and compatible contributions
    Apps-->>BFF: Built-in and app widget descriptors
    BFF-->>Builder: Authorized widget palette
    Author->>Builder: Add widget and choose AAS binding
    Builder->>BFF: Validate and resolve proposed binding
    BFF->>Policy: Check author and target read rights
    BFF->>Router: Resolve exact reference or semantic path
    Router->>Target: Read matching model metadata
    Target-->>Router: Match candidates and types
    Router-->>BFF: Resolved, ambiguous, missing or incompatible
    BFF-->>Builder: Binding result and diagnostics
    Author->>Builder: Configure layout and widget
    Builder->>Renderer: Preview draft definition
    alt Built-in widget
        Renderer->>BFF: Read through scoped binding
    else App-provided widget
        Renderer->>AppWidget: Load in isolated frame with scoped handle
        AppWidget->>BFF: Studio SDK binding capability call
    end
    BFF->>Policy: Authorize user, widget/app, target and operation
    BFF->>Router: Execute permitted preview read
    Router->>Target: AAS API request
    Target-->>Router: AAS value
    Router-->>BFF: Typed value
    alt Built-in widget result
        BFF-->>Renderer: Scoped result
    else App-provided widget result
        BFF-->>AppWidget: Scoped result
        AppWidget-->>Renderer: Sandboxed rendered content
    end
    Author->>Builder: Save view
    Builder->>BFF: Definition with expected revision
    BFF->>BFF: Validate schema, widgets and bindings
    BFF->>DB: Persist versioned definition and access rules
    BFF-->>Builder: Saved revision

    Viewer->>Renderer: Open view with target context
    Renderer->>BFF: Load authorized definition
    BFF->>DB: Read and migrate definition
    DB-->>BFF: Definition and revision
    BFF->>Policy: Authorize view and current target access
    BFF-->>Renderer: Definition, widget grants and binding diagnostics
    Renderer->>Renderer: Render available widgets
    opt Target data changes or becomes stale
        BFF-->>Renderer: SSE invalidation or polling result
        Renderer->>BFF: Refresh affected bindings
        BFF-->>Renderer: Newly authorized values
    end
```

## Desktop local AASX lifecycle

The renderer cannot access the file system directly. Electron brokers native
dialogs, and a supervised Workspace Worker performs validation, revisions, and
serialization within the selected project directory.

```mermaid
sequenceDiagram
    actor User
    participant UI as Sandboxed Electron renderer
    participant Native as Electron native broker
    participant Studio as Local Studio Service
    participant Worker as Local Workspace Worker
    participant Disk as User-selected project directory

    User->>UI: Open local project
    UI->>Native: Request native directory or file dialog
    Native-->>UI: Approved path handle
    UI->>Studio: Open project handle
    Studio->>Worker: Import project and AASX package
    Worker->>Disk: Read project metadata and package
    Worker->>Worker: Validate and build workspace state
    Worker-->>Studio: Workspace ID, revision, and diagnostics
    Studio-->>UI: Editable workspace

    User->>UI: Edit AAS element
    UI->>Studio: Command with expected revision
    Studio->>Worker: Apply validated operation
    Worker->>Disk: Write atomic revision and recovery metadata
    Worker-->>Studio: New revision
    Studio-->>UI: Updated result

    User->>UI: Save or export package
    UI->>Studio: Export current revision
    Studio->>Worker: Serialize package
    Worker->>Disk: Atomic write through temporary file
    Worker-->>Studio: Saved artifact metadata
    Studio-->>UI: Save complete
```

## Publish, install, and activate an app

Apps are built and signed by the marketplace pipeline. Installation creates a
deployment- or machine-scoped record; activation additionally evaluates
permissions, administrator policy, user visibility, and AAS semantic
compatibility.

```mermaid
sequenceDiagram
    actor Publisher
    actor Admin
    participant Portal as Publisher portal
    participant Pipeline as Marketplace build and review
    participant Registry as Signed artifact registry
    participant Studio as Studio app manager
    participant Policy as Policy and permission store
    participant Target as Active AAS target
    participant Runtime as Isolated app runtime

    Publisher->>Portal: Submit source, manifest, and metadata
    Portal->>Pipeline: Reproducible build and automated checks
    Pipeline->>Pipeline: Scan dependencies and review capabilities
    Pipeline->>Registry: Sign and publish immutable artifacts

    Admin->>Studio: Install app version
    Studio->>Registry: Fetch manifest and artifacts
    Registry-->>Studio: Signed app package
    Studio->>Studio: Verify signature, compatibility, and integrity
    Studio->>Policy: Record install scope and approved capabilities

    Studio->>Target: Read semantic IDs and target capabilities
    Target-->>Studio: Compatibility facts
    Studio->>Policy: Evaluate user visibility and applicability
    Policy-->>Studio: Activation decision
    Studio->>Runtime: Start verified app with capability token
    Runtime-->>Studio: Ready
```

## Installed app capability call

An app receives no ambient authority. Every AAS, file, network, or shared Studio
operation goes through a narrow capability API and is evaluated against the
installed manifest plus deployment policy.

```mermaid
sequenceDiagram
    participant App as Sandboxed UI or backend app
    participant Broker as Studio capability broker
    participant Policy as Capability policy
    participant Router as AAS target router
    participant Files as File broker
    participant Egress as Network egress proxy
    participant Audit as Audit store

    App->>Broker: Invoke named capability with scoped token
    Broker->>Policy: Validate app, user, target, and arguments
    Policy-->>Broker: Allowed scope and limits
    alt AAS operation
        Broker->>Router: Execute typed AAS operation
        Router-->>Broker: Result
    else User-approved file operation
        Broker->>Files: Read or write approved handle
        Files-->>Broker: Result
    else Approved third-party request
        Broker->>Egress: Request allow-listed destination
        Egress-->>Broker: Filtered response
    end
    Broker->>Audit: Record security-relevant operation
    Broker-->>App: Structured result
```

## Desktop update from an older version

Desktop releases are signed and update metadata is verified. The updater must
support at least the current version and the previous two supported release
lines, including ordered configuration and workspace migrations.

```mermaid
sequenceDiagram
    actor User
    participant Studio as Running desktop Studio
    participant Updates as Signed update service
    participant Updater as Electron updater process
    participant Migrations as Migration runner
    participant Health as Startup health check

    Studio->>Updates: Check channel and current version
    Updates-->>Studio: Signed metadata and compatible migration path
    Studio->>Studio: Verify signature, platform, and version policy
    Studio-->>User: Update available
    User->>Studio: Install update
    Studio->>Updater: Download and stage artifact
    Updater->>Updater: Verify checksum and publisher signature
    Updater->>Migrations: Back up metadata and run ordered migrations
    Migrations-->>Updater: Migration result
    Updater->>Health: Start candidate version
    alt Candidate healthy
        Health-->>Updater: Ready
        Updater->>Updater: Activate version and retain recovery data
        Updater-->>User: Studio updated
    else Startup or migration failed
        Health-->>Updater: Failure
        Updater->>Updater: Restore compatible metadata and previous version
        Updater-->>User: Update rolled back with diagnostics
    end
```

## Realtime transport rule

Queries and commands use ordinary HTTP. Server-Sent Events are the default for
one-way progress and invalidation. WebSockets are introduced only for a proven
bidirectional use case such as collaborative editing or interactive app
protocols; they are not the CRUD transport.
