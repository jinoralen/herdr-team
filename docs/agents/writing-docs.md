# Writing command pages

Every command has a human-facing **page** at `docs/commands/hub/<command>.md`. README.md is the index: one
line per command, linking to its page. A page orients one reader around one command: what it does,
when to use it, and what to expect. It is not a copy of the code or of `--help`.

AGENTS.md says when to write or re-sync a page. A renamed command's page moves with it; a removed
command's page is deleted, along with its README line.

## Page structure

Keep this order. `What it does`, `When to use it` and `Where it fits` appear on every page; the rest
only where the command needs them.

<page-template>

# `<command>`

## What it does

One or two plain paragraphs. Lead with the command's one-sentence job, then its **defining
constraint**: the one fact that makes it behave differently from the obvious default (for `message`:
the text addresses nobody; `--to` alone decides who gets it). Never omit this line.

## When to use it

- **Who runs it**: an agent, Herdr, or the user, and from where.
- **Trigger**: "use this when …". Where it's confusable with another command, add "for <X>, use
  [<other>](<other>.md)."

## <free-form middle>

One to three short sections in the domain's own words (see GLOSSARY.md): the guarantees the command
gives, the choices it offers, the case people get wrong. State guarantees and their reasons; leave
the step-by-step mechanics to the code and its tests. Link the ADR behind a decision rather than
re-arguing it.

## Common questions

Questions people have actually asked, each in bold with the answer beneath. Find them in session
logs, reviews and issues before writing; an invented question teaches nothing. Size the section to
what you find, sharpest first; omit it when there is nothing.

## It's working if

A few signs the reader can check without reading the source: what they see in the panes, in
`status`, or in the output.

## Where it fits

A sentence or two: where the command sits in a conversation (join → message ⇄ delivery → leave), and
the one or two commands next to it, each with a because-clause.

</page-template>

## Conventions

- Explain the **why**, not the process. A guarantee ("a crash never loses a message") belongs here;
  how the code achieves it (which table, which transaction) does not.
- Use GLOSSARY.md's terms, and none of the words it says to avoid.
- Choices go in a table or a list, never in a paragraph.
- Links are relative.

## Done when

- The page exists at `docs/commands/hub/<command>.md`, and README.md links it with a one-line summary.
- `What it does` states the defining constraint.
- `When to use it` says who runs it and when.
- Every `Common questions` entry was asked somewhere; none is invented.
- Every `It's working if` bullet is checkable without reading the source.
- No page restates another page, an ADR, or the code's mechanics.
