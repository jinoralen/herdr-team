// Fake executables (herdr, agents) for the tests that run real processes. Each is written once per
// content and reused, by later tests and later runs: macOS checks a new executable on its first run,
// which takes 200–300ms, against about 10ms after that. Per-test data goes through the environment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function fakeBin(name: string, content: string): string {
  const dir = path.join(os.tmpdir(), 'herdr-team-test-bin', Bun.hash(content).toString(36));
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    // Parallel test files may write the same one: each renames a complete file into place.
    const partial = `${file}.${process.pid}.${crypto.randomUUID()}`;
    fs.writeFileSync(partial, content, { mode: 0o755 });
    fs.renameSync(partial, file);
  }
  return file;
}
