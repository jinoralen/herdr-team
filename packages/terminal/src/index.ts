// Terminal-safe text and shell quoting shared by hub and compose.
export function sanitizeForTerminal(text: string): string {
  // Strip control chars (escape sequences) but keep newlines and tabs.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

export function shellQuote(word: string): string {
  return /^[\w/.,:@%+=-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
