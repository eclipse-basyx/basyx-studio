# Deployment Variants

These are the canonical component diagrams for the three primary variants. Each diagram shows only components valid for that variant and uses subgraphs to distinguish deployable/service/process ownership.

Shared rule: the same Studio UI and installed apps call one versioned Studio API
and capability surface in every variant. The BFF/target router selects the
implementation-specific AAS adapter and returns common DTOs, capabilities,
revisions, and errors. HTTP is the default request/response transport, SSE
carries one-way progress and invalidation events with polling as fallback, and
WebSockets are reserved for proven bidirectional workflows.

## 1. Hosted web Studio with live AAS infrastructure

This variant covers hosted catalogues and other live Type 2 shell workflows. The
configured BaSyx infrastructures may be remote or on the same private network,
but they are independent from the Studio deployment.

```mermaid
flowchart LR
    subgraph Device["User device"]
        subgraph Browser["Browser runtime"]
            CoreUI["Studio Vue UI"]
            Dashboard["Graphical view builder<br/>and renderer"]
            UIApp["Sandboxed UI app<br/>isolated iframe"]
        end
    end

    subgraph StudioDeployment["BaSyx Studio web deployment"]
        subgraph StudioService["Studio Service - one Nuxt/Nitro Node.js deployable"]
            WebEntry["Nuxt SSR and assets"]
            BFF["Studio API / BFF"]
            Auth["User sessions and<br/>downstream token broker"]
            TargetRouter["AAS target router"]
            TSSDK["BaSyx TypeScript SDK<br/>clients per target"]
            Transfer["Cross-target AAS<br/>copy workflow"]
            Views["View definitions<br/>and binding metadata"]
            Capabilities["Studio and app<br/>capability broker"]
            AppManagement["App installation, visibility,<br/>permissions and compatibility"]
            Admin["Deployment and infrastructure admin"]
        end

        subgraph AppAssets["App Asset Service - separate app origin"]
            UIBundles["Verified UI app bundles"]
        end

        subgraph AppRunner["App Runner Service - separate containers or pods"]
            BackendApp["Installed backend app<br/>isolated runtime"]
            Egress["Permission-controlled egress"]
        end

        subgraph StudioData["Studio-controlled data services"]
            StudioDB[("PostgreSQL<br/>configuration, sessions, apps, views,<br/>ACLs and audit")]
            Secrets["Deployment secret store"]
        end
    end

    subgraph BaSyxDeployment["One or more BaSyx Go deployments - independent"]
        AASRepo["AAS Repository"]
        SMRepo["Submodel Repository"]
        Registries["AAS and Submodel Registries"]
        Discovery["AAS Discovery"]
        BaSyxDB[("BaSyx data store")]
    end

    subgraph Marketplace["Central BaSyx App Store - independent"]
        Catalog["Catalogue API"]
        OCI["OCI registry<br/>signed artifacts"]
    end

    IdP["OIDC providers<br/>per infrastructure"]
    ThirdParty["Approved third-party services"]
    Observability["Shared OTel / Grafana platform"]

    CoreUI <-->|"HTTPS"| WebEntry
    CoreUI -->|"Studio API"| BFF
    CoreUI --> Dashboard
    Dashboard -->|"view definitions"| BFF
    Dashboard -->|"AAS bindings"| Capabilities
    Dashboard -->|"embed app widget"| UIApp
    UIApp -->|"Studio SDK RPC"| Capabilities
    UIBundles -->|"isolated load"| UIApp

    BFF --> Auth
    BFF --> TargetRouter
    BFF --> Transfer
    BFF --> Views
    Transfer --> TargetRouter
    TargetRouter --> TSSDK
    Capabilities --> TargetRouter
    BackendApp -->|"capability token"| Capabilities
    Capabilities --> Egress
    Egress --> ThirdParty

    TSSDK --> AASRepo
    TSSDK --> SMRepo
    TSSDK --> Registries
    TSSDK --> Discovery
    AASRepo --> BaSyxDB
    SMRepo --> BaSyxDB
    Registries --> BaSyxDB
    Discovery --> BaSyxDB

    Auth <-->|"authorization code or client credentials"| IdP
    Auth --> StudioDB
    Auth --> Secrets
    AppManagement --> StudioDB
    Admin --> StudioDB
    Views --> StudioDB

    Catalog -.->|"metadata"| AppManagement
    OCI -.->|"verified install"| AppManagement
    AppManagement --> UIBundles
    AppManagement --> BackendApp

    BFF -.->|"traces, metrics, JSON logs"| Observability
    AppRunner -.->|"runner telemetry"| Observability
    AASRepo -.->|"BaSyx telemetry"| Observability
```

## 2. Desktop Studio with live AAS infrastructure

There is no hosted Studio backend. The local Studio Service connects to one or
more Internet, private-network, or localhost/Docker BaSyx infrastructures.

```mermaid
flowchart LR
    subgraph Computer["User computer"]
        subgraph ElectronApp["Signed BaSyx Studio Electron installation"]
            subgraph Renderer["Sandboxed Electron renderer"]
                CoreUI["Studio Vue UI"]
                Dashboard["Graphical view builder<br/>and renderer"]
                UIApp["Sandboxed UI app"]
            end

            subgraph MainProcess["Electron main process"]
                Lifecycle["Window and process lifecycle"]
                NativeBroker["Native file and dialog broker"]
                UpdateClient["Signed update client"]
            end

            subgraph LocalStudio["Local Studio Service - Nitro Node.js child process"]
                BFF["Studio API / local BFF"]
                Auth["OIDC session and token broker"]
                TargetRouter["AAS target router"]
                TSSDK["BaSyx TypeScript SDK<br/>clients per target"]
                Transfer["Cross-target AAS<br/>copy workflow"]
                Views["View definitions<br/>and binding metadata"]
                Capabilities["Studio and app<br/>capability broker"]
                AppManagement["Local app installation<br/>and compatibility"]
            end

            subgraph ExtensionHost["Backend app extension host - separate process"]
                BackendApp["Installed backend app"]
                Egress["Permission-controlled egress"]
            end

            AppCache[("Verified local app bundles")]
        end

        subgraph OSResources["Operating-system resources"]
            LocalDB[("SQLite<br/>infrastructures, apps, views,<br/>preferences and audit")]
            Keychain[("OS keychain")]
            LocalFiles[("User-selected files")]
            SystemBrowser["System browser"]
        end
    end

    subgraph BaSyxDeployment["One or more BaSyx Go deployments - Internet, private network or localhost/Docker"]
        AASRepo["AAS Repository"]
        SMRepo["Submodel Repository"]
        Registries["Registries"]
        Discovery["Discovery"]
        BaSyxDB[("BaSyx data store")]
    end

    subgraph Marketplace["Central BaSyx App Store"]
        Catalog["Catalogue API"]
        OCI["OCI registry<br/>signed artifacts"]
    end

    IdP["Infrastructure OIDC providers"]
    UpdateService["Studio update service"]
    ThirdParty["Approved third-party services"]

    CoreUI -->|"loopback Studio API"| BFF
    CoreUI --> Dashboard
    Dashboard -->|"view definitions"| BFF
    Dashboard -->|"AAS bindings"| Capabilities
    Dashboard -->|"embed app widget"| UIApp
    UIApp -->|"Studio SDK RPC"| Capabilities
    Lifecycle --> Renderer
    Lifecycle --> LocalStudio
    NativeBroker --> LocalFiles

    BFF --> Auth
    BFF --> TargetRouter
    BFF --> Transfer
    BFF --> Views
    Transfer --> TargetRouter
    TargetRouter --> TSSDK
    Auth --> Keychain
    Auth --> SystemBrowser
    SystemBrowser <-->|"interactive login and callback"| IdP
    Auth <-->|"code exchange and token refresh"| IdP

    TSSDK --> AASRepo
    TSSDK --> SMRepo
    TSSDK --> Registries
    TSSDK --> Discovery
    AASRepo --> BaSyxDB
    SMRepo --> BaSyxDB
    Registries --> BaSyxDB
    Discovery --> BaSyxDB

    Capabilities --> TargetRouter
    Capabilities --> NativeBroker
    BackendApp -->|"capability token"| Capabilities
    Capabilities --> Egress
    Egress --> ThirdParty

    AppManagement --> LocalDB
    Views --> LocalDB
    Catalog -.->|"metadata"| AppManagement
    OCI -.->|"download and verify"| AppManagement
    AppManagement --> AppCache
    AppCache --> UIApp
    AppCache --> BackendApp
    UpdateClient -.->|"signed Studio update"| UpdateService
```

## 3. Desktop Studio with local AASX workspace

This is the offline package-explorer/designer replacement. It has no BaSyx server dependency.

```mermaid
flowchart LR
    subgraph Computer["User computer"]
        subgraph ElectronApp["Signed BaSyx Studio Electron installation"]
            subgraph Renderer["Sandboxed Electron renderer"]
                CoreUI["Studio Vue UI"]
                Dashboard["Graphical view builder<br/>and renderer"]
                UIApp["Sandboxed UI app"]
            end

            subgraph MainProcess["Electron main process"]
                Lifecycle["Window and process lifecycle"]
                NativeBroker["Native workspace, file<br/>and dialog broker"]
                UpdateClient["Signed update client"]
            end

            subgraph LocalStudio["Local Studio Service - Nitro Node.js child process"]
                BFF["Studio API / local BFF"]
                TargetRouter["AAS target router"]
                WorkspaceClient["Local Workspace API client"]
                Views["View definitions<br/>and binding metadata"]
                Capabilities["Studio and app<br/>capability broker"]
                AppManagement["Local app installation<br/>and semantic compatibility"]
            end

            subgraph WorkspaceWorker["Local Workspace Worker - separate trusted utility process"]
                WorkspaceAPI["Local Workspace API"]
                ModelService["AAS model and semantic service"]
                PackageEngine["AASX parser, validator<br/>and serializer"]
                SnapshotService["Draft and recovery snapshots"]
            end

            subgraph ExtensionHost["Backend app extension host - separate process"]
                BackendApp["Installed backend app"]
                Egress["Permission-controlled egress"]
            end

            AppCache[("Verified local app bundles")]
        end

        subgraph OSResources["Operating-system resources"]
            LocalDB[("SQLite<br/>projects, apps, views,<br/>preferences and audit")]
            WorkspaceFolder[("User workspace folder")]
            AASX[("project.aasx")]
            Snapshots[("Recovery snapshots")]
        end
    end

    subgraph Marketplace["Central BaSyx App Store - used when online"]
        Catalog["Catalogue API"]
        OCI["OCI registry<br/>signed artifacts"]
    end

    UpdateService["Studio update service"]
    ThirdParty["Approved third-party services"]

    CoreUI -->|"loopback Studio API"| BFF
    CoreUI --> Dashboard
    Dashboard -->|"view definitions"| BFF
    Dashboard -->|"AAS bindings"| Capabilities
    Dashboard -->|"embed app widget"| UIApp
    UIApp -->|"Studio SDK RPC"| Capabilities
    Lifecycle --> Renderer
    Lifecycle --> LocalStudio
    Lifecycle --> WorkspaceWorker

    BFF --> TargetRouter
    BFF --> Views
    Views --> LocalDB
    TargetRouter --> WorkspaceClient
    WorkspaceClient --> WorkspaceAPI
    WorkspaceAPI --> ModelService
    WorkspaceAPI --> PackageEngine
    WorkspaceAPI --> SnapshotService

    NativeBroker --> WorkspaceFolder
    WorkspaceFolder --> AASX
    NativeBroker --> PackageEngine
    PackageEngine <-->|"read and write"| AASX
    SnapshotService --> Snapshots

    Capabilities --> TargetRouter
    Capabilities --> NativeBroker
    BackendApp -->|"capability token"| Capabilities
    Capabilities --> Egress
    Egress --> ThirdParty

    AppManagement --> LocalDB
    Catalog -.->|"metadata"| AppManagement
    OCI -.->|"download and verify"| AppManagement
    AppManagement --> AppCache
    AppCache --> UIApp
    AppCache --> BackendApp
    UpdateClient -.->|"signed Studio update"| UpdateService
```

## Boundary summary

- Studio Service: trusted Nuxt/Nitro BFF in every variant; hosted centrally or spawned locally.
- Graphical view builder/renderer: Studio UI module in every variant; definitions use the existing Studio database.
- Cross-target AAS copy: Studio Service module only in the two live-infrastructure variants.
- Local Workspace Worker: only desktop AASX.
- Live BaSyx deployment: only connected variants.
- App runner/extension host: outside the Studio Service in every variant.
- App Store: central independent platform shared by all variants.
