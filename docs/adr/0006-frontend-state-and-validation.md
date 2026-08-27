# 0006: Frontend state and validation

- Status: Accepted
- Date: 2026-08-24
- Deciders: BaSyx Studio maintainers
- Requirements: DATA-001, DATA-005, APP-006, APP-007, SEC-006

## Context

The team values pragmatic Vue/Nuxt development. A remote-state query layer and
Zod can solve real problems, but applying either universally would duplicate
Nuxt, Pinia, generated SDK types, JSON Schema, and AAS domain validation.

TanStack Query has the longer track record and broadest cross-framework feature
surface. Pinia Colada provides the Studio-relevant query, mutation, cache,
invalidation, optimistic-update, pagination, and SSR behavior while using Pinia
and Vue reactivity directly. Studio does not need cross-framework portability.

## Decision

Use the smallest state tool that matches ownership:

- local Vue state for component interaction;
- Pinia for client-owned UI state, active target context, and editable drafts;
- Nuxt `useFetch`/`useAsyncData` for straightforward SSR-aware page data;
- Pinia Colada only for complex shared remote state that materially benefits from
  invalidation, deduplication, pagination, polling, or optimistic mutation.

When Pinia Colada is used, every AAS-related query key contains the target ID and
relevant revision/context. Prefer the Nuxt module for SSR serialization and
hydration. Enable retry, auto-refetch, or persistence plugins only where the
feature requires them. Do not mirror the same authoritative remote value in
both an ordinary Pinia store and the Pinia Colada query cache.

Use validation by trust boundary:

- Zod for TypeScript-owned, untrusted runtime inputs such as environment values,
  small Studio API payloads, and capability RPC messages;
- JSON Schema with a standards-compliant validator such as Ajv for public,
  versioned app manifests and other ecosystem contracts;
- generated AAS types plus AAS Core validation and semantic rules for AAS data;
- database constraints and authorization checks at persistence boundaries.

Infer TypeScript types from schemas where practical. Do not rewrite the complete
AAS model as Zod schemas.

## Consequences

- The default remains familiar and lightweight for the BaSyx team.
- Pinia Colada can be introduced feature-by-feature without forcing all Nuxt data
  access through it or adding a second framework-neutral state model.
- Target switching cannot leak cached data when query-key rules are followed.
- Public app tooling is language-neutral and not coupled to Zod.
- Validation is intentionally layered; static TypeScript types do not establish
  runtime trust.
- The smaller Pinia Colada ecosystem is an accepted trade-off; a concrete
  unsupported requirement can justify reconsidering TanStack Query in a later
  ADR.

## Alternatives considered

- **Pinia Colada for every request:** rejected because it overlaps with Nuxt's SSR
  data primitives and increases state-ownership ambiguity.
- **TanStack Query as the default query layer:** rejected because Studio is a
  Vue/Nuxt-only product and Pinia Colada covers its expected remote-state needs
  with more direct Vue, Pinia, and Nuxt integration. TanStack remains a valid
  fallback if a measured capability gap emerges.
- **Pinia for all server data:** rejected because manual invalidation, races, and
  loading/error state scale poorly for complex remote resources.
- **Zod everywhere:** rejected because it duplicates AAS schemas and makes public
  manifests TypeScript-centric.
- **No runtime validation:** rejected because apps, packages, environment values,
  and remote responses cross trust boundaries.
