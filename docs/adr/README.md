# Architecture Decision Records

One file per decision: `NNNN-short-title.md`.

Template:

```markdown
# ADR-NNNN: Title

- Status: proposed | accepted | superseded
- Date: YYYY-MM-DD
- Deciders: ...

## Context

What problem are we solving? What constraints matter?

## Decision

What we will do.

## Alternatives considered

What else was on the table, and why not.

## Consequences

What becomes easier, what becomes harder, what we must revisit.
```

## Index

| ADR | Title | Status |
|---|---|---|
| 0001 | PDF architecture: client-first with server fallback | proposed (spike) |
| 0002 | Single search engine: PostgreSQL FTS | accepted |
| 0003 | On-prem-ready from day one | accepted |
| 0004 | AI as an optional layer, not in MVP | accepted |
| 0005 | DSpace as a source, platform as reading layer | accepted |
| 0006 | V1 split into V1a (infrastructure) and V1b (discovery/AI) | accepted |
| 0012 | EPUB engine: epub.js for MVP/V1a behind an adapter; Readium/R2D2BC fallback thresholds | accepted (MVP/V1a) |
