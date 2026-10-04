# Domain Docs

This repository uses a single-context layout. These rules tell engineering skills how to consume its domain documentation.

## Before exploring, read these

- Root `CONTEXT.md` for the domain vocabulary.
- Relevant ADRs in root `docs/adr/` for decisions affecting the area being explored.

If a document or directory is absent, proceed silently. Do not propose creating empty domain documents or placeholder ADRs. The `domain-modeling` skill creates them lazily when terms or decisions are resolved.

## File structure

```text
/
├── CONTEXT.md
├── docs/
│   ├── agents/
│   │   ├── issue-tracker.md
│   │   ├── triage-labels.md
│   │   └── domain.md
│   └── adr/                 # Created when the first ADR is needed
└── src/
```

Preserve the existing root glossary. No `CONTEXT-MAP.md` or per-context glossary is needed for the current layout.

## Use the glossary's vocabulary

When naming a domain concept in an issue, refactor proposal, hypothesis, or test, use the term defined in `CONTEXT.md`. Avoid synonyms the glossary explicitly rejects.

When a needed concept is missing, reconsider whether the project needs that term; record a genuine gap through `domain-modeling`. Keep `CONTEXT.md` a glossary rather than an implementation plan.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain why reopening the decision is warranted. Do not silently override it.
