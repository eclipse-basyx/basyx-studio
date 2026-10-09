# Example apps

Studio apps that prove the app platform (MVP-3, [ADR 0004](../../docs/adr/0004-runtime-installable-apps.md)):

| App | Contributes | Permissions |
| --- | --- | --- |
| `nameplate` | Submodel view for the Digital Nameplate (IDTA 02006, versions 2.0 and 3.0) | read, write, notifications |
| `shell-explorer` | Target module with nested routes; shell module | read, navigation |
| `backend-demo` | Target module with a Deno backend | read, backend |

Each app is a Vite + Vue + Vuetify project that uses `@basyx/studio-sdk`.
Build all apps and package them as installable `.zip` files:

```bash
pnpm apps:build
```

The packages are written to `examples/apps/dist/`. Install them on the
*Apps* admin page (developer mode: `STUDIO_APPS_ALLOW_UNSIGNED=true`).
