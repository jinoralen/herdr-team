// An error that waiting fixes: a handle whose old member still has posts to deliver is free once
// a tick has delivered them. Exits with EX_TEMPFAIL, so callers can retry without reading the text.
export class RetryLater extends Error {
  readonly exitCode = 75;
}

// The exit code for an error the CLI prints: its own, or 1.
export function exitCode(error: unknown): number {
  return error instanceof RetryLater ? error.exitCode : 1;
}
