# 0029: Submodel template sources and instantiation

- Status: Accepted
- Date: 2026-10-14
- Deciders: BaSyx Studio maintainers
- Requirements: PROD-004

## Context

The creation wizard needs submodel templates, and users want instances from
types and from template submodels. The Web UI bundles four IDTA templates and
a wizard step per template.

## Decision

- Template sources: (a) the IDTA templates Digital Nameplate, Technical Data,
  Handover Documentation and Contact Information, bundled in
  `server/lib/templates/` and versioned with Studio; (b) submodels with
  `kind: Template` of the shells on the target; (c) a JSON file as a submodel.
  A template registry or the IDTA repository online comes later.
- Instantiation (`shared/aas/templates.ts`) gives a copy a new ID and kind
  `Instance`, removes qualifiers of kind `TemplateQualifier`, leaves out
  optional elements (cardinality `ZeroToOne`, `ZeroToMany`) unless selected and
  applies the values of the wizard's generic form. The template's
  `templateId` is not carried over to the instance.
- *Create instance* copies a shell of asset kind `Type` with new IDs and
  `derivedFrom`; *Convert to instance* does the qualifier removal in place and
  needs the submodel's kind to be `Template`.
- The wizard has one generic form per template, driven by the template's
  structure and cardinality; the Web UI's template-specific steps are not
  ported.
- A multi-resource write runs submodels first, then the shell, then the
  registries; a failure stops the later steps and answers `partial_write`
  with the steps. There is no automatic rollback on live targets.

## Consequences

- New IDTA template versions need a Studio release until a registry exists.
- Leftovers of a partial write are visible in the steps and can be deleted.
