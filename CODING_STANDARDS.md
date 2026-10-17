# Coding standards

The conventions this code follows that Biome, Knip and the type checker don't enforce. Module
layout and the import boundary are in the README ("Code layout"); `biome.json` holds the rest.

## Comments

- Every file opens with a comment saying what it is, in domain words: "One room's rows: its
  members and the messages waiting for them."
- Comment a function, field or constant when its name leaves out the why or the contract: what a
  return value means (`// Returns true if another pass was requested meanwhile`), the race it
  guards, the reason for a limit. One or two plain sentences.
- Use the domain's words: room, member, handle, post, delivery, queue, pass, tick, lock. When
  `GLOSSARY.md` exists, its terms win.

## Values and types

- Absent is `null`, never `undefined`: lookups return `T | null` (`.get() ?? null`).
- `type` aliases for data shapes; `interface` only for a boundary a fake implements (`Herdr`).
- Name constants in UPPER_SNAKE_CASE with a comment saying why the value is what it is
  (`MAX_DESCRIPTION_CHARS`: a role, not a place for a brief).
- Inject what varies or touches the outside world (`root`, `herdr`, `env`, `now`, `log`) through
  an options object with defaults. Keep state in instances, not module globals.

## Errors

- An error an agent reads is a full sentence that says what to do next, naming the command with
  `SELF` (the executable's full path): `Usage: ${SELF} join <agent type or description>`.
- Throw plain `Error` for agent-facing problems; `HerdrError` with a `code` for Herdr failures, so
  callers branch on `code`, not on message text.
- The CLI prints `error: <message>` and sets `process.exitCode = 1`, letting the process end on
  its own.
- Isolate failures per room: one room's error is logged and the pass moves on; what it couldn't
  deliver stays queued for the next pass.

## Outside input

- Validate everything Herdr returns with Zod `safeParse`; on failure throw a `HerdrError`
  (`invalid_response`).
- Pass agent-written text through `sanitizeForTerminal` before it reaches a pane.
- Spawn processes with an argv array (`Bun.spawn([bin, ...args])`), so message text stays one
  argument and never meets a shell.

## Concurrency

Ticks and agents' commands run as separate processes against one database, and Herdr calls take
seconds. Review rounds kept finding stale reads, so:

- Treat anything read before an `await` (a member, its queue, an agent's state) as stale after it.
  Re-read it inside the transaction that acts on it, and skip the work if it changed.
- A process that may have lost the lock (`owns()`) checks before acting, not after.

## Store

- Scope every query to `this.room`.
- Agents' commands and ticks race. A membership change applies only if the member is still the
  same join (`joined_at`) in an expected status, and returns whether it applied; a caller that
  loses skips that member.
- Put writes that must land together in `store.transaction()`.
- Text the hub composes from other texts (warnings, batches) obeys the same caps as what agents
  post: `MAX_MESSAGE_CHARS` per row, 100 KB per delivery. Split, never truncate.

## Docs move with behaviour

- A change to delivery, membership, or any text agents read (guide, delivery header, reply hint,
  errors) updates README.md in the same change, so the two never disagree.
- A change that reverses a decision in `docs/adr/` updates or supersedes that ADR.

## Tests

- `test` from `bun:test` with `node:assert/strict`.
- Name a test by the behaviour it pins, as a sentence: "blocked agents are held and never
  prompted".
- Drive rooms through `installed()` / `setup()` from `#testing`, with `FakeHerdr` as the only fake:
  real store, real database in a fresh state directory. Test the CLI by running the real program
  (`cli/tests/`).
