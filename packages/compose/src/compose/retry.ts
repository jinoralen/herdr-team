// An error that waiting fixes: hub has yet to retire a closed helper's membership or deliver its
// posts. Exits with EX_TEMPFAIL, like hub's, so callers can retry without reading the text.
// EX_TEMPFAIL from sysexits.h: the code hub exits with for the same case.
export const RETRY_LATER_EXIT = 75;

export class RetryLater extends Error {
  readonly exitCode = RETRY_LATER_EXIT;
}

// The exit code for an error: its own, or 1.
export function exitCode(error: unknown): number {
  return error instanceof RetryLater ? error.exitCode : 1;
}
