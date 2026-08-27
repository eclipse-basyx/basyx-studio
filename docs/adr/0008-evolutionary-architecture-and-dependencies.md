# 0008: Evolutionary architecture and dependency justification

- Status: Accepted
- Date: 2026-08-25
- Deciders: BaSyx Studio maintainers
- Requirements: ARCH-001 through ARCH-008

## Context

Studio has three primary deployment/data variants, local package processing, authentication,
and runtime-installable apps. Those requirements create real complexity, but
they do not justify speculative services, abstractions, or infrastructure. The
former UI also demonstrates how features added without a coherent target model
can reduce maintainability.

Every dependency and deployable becomes an update, security, compatibility,
testing, documentation, and operational responsibility. Architecture must make
necessary boundaries visible without turning internal modules into a distributed
system by default.

## Decision

Use an evolutionary modular architecture:

1. Keep SSR, BFF routes, target management, copy workflows, view definitions,
   bindings, app management, and capability brokering as modules of one Studio
   Service.
2. Use another process or deployable only for a concrete trust boundary,
   resource/crash isolation requirement, independent release lifecycle, or
   measured scaling need. The desktop Workspace Worker and app runners meet this
   test.
3. Require every major dependency, datastore, broker, runtime, or service to
   document the capability/risk it addresses, maintained code it removes,
   alternatives, transitive and operational cost, security posture, license,
   maturity, and exit strategy.
4. Extract shared packages only after a real workflow establishes the contract
   and at least one real consumer proves the boundary.
5. Keep the baseline hosted deployment runnable without Kubernetes, a service
   mesh, Redis, Kafka, or MQTT. Scale-out profiles are optional later decisions.
6. Time-box architecture experiments and define adoption evidence before the
   experiment starts.

Small dependencies still require normal code review, but not every utility needs
an ADR. An ADR is required when a choice changes a cross-cutting runtime,
persistence, security, deployment, or public-contract decision.

## Consequences

- Developers can find domain boundaries without making network calls between
  every feature.
- Cross-infrastructure copy and graphical dashboards reuse the target, SDK,
  database, app sandbox, and capability paths instead of creating parallel
  platforms.
- Pull requests introducing architectural complexity must state why simpler
  options are insufficient.
- Some abstractions are intentionally delayed until implementation evidence is
  available.
- A module may later be extracted without changing its product contract, but
  extraction is not treated as inevitable progress.

## Alternatives considered

- **Microservices per domain from the start:** rejected because independent
  operation and scaling are unproven and distributed failure modes would slow
  the first product increments.
- **One unrestricted process for everything:** rejected because untrusted package
  processing and third-party app code require real isolation boundaries.
- **Ban new dependencies:** rejected because a well-maintained dependency can
  remove more risk and code than it adds; the decision must be evidence-based.
- **Build generic extension and low-code frameworks first:** rejected because the
  app and view contracts should be extracted from working vertical slices.
