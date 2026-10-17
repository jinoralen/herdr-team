# Issue tracker: Local Markdown

Specs and tickets are Markdown files in this repo.

- A spec is docs/plans/<feature>/spec.md. /to-spec writes it from
  its template; a spec written by hand records the goal, scope,
  agreed behavior, and verification criteria.
- Tickets exist only when the work needs decomposition: one file
  per ticket under docs/plans/<feature>/issues/, named
  <NN>-<slug>.md, numbered from 01 with blockers first.
- Where a skill names `.scratch/<feature>/`, use docs/plans/<feature>/.
- Triage labels are the `**Status:**` line. The only values:
  ready-for-agent (agreed, ready to implement) and done
  (implemented and merged). Close work by setting it to done.
- When a skill says "publish," save locally.
- When fetching a ticket, read the referenced local file.
