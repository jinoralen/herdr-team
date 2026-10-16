// Who a post goes to: the agents named with `--to`, or every other member without it. Nothing in
// the text addresses anyone, so emails, URLs, `@types/bun` or decorators are just text.

// `--to codex,pi` (a leading @ is fine): the handles, lowercase, each once.
export function parseTo(value: string): string[] {
  const handles = value
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  return [...new Set(handles)];
}

// The member a post seems written to, when it starts with "@handle" but has no --to: worth a
// reminder, since it goes to everyone.
export function leadingMention(text: string, members: readonly string[]): string | null {
  const handle = text
    .trimStart()
    .match(/^@([A-Za-z0-9][A-Za-z0-9_-]*)/)?.[1]
    ?.toLowerCase();
  return handle && members.includes(handle) ? handle : null;
}
