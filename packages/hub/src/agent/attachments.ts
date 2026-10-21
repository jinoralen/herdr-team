// Files attached to a post: copied into the state directory's files/ when posted, so every member
// reads the same snapshot by path even if the author keeps editing the original.

import fs from 'node:fs';
import path from 'node:path';
import { filesDir } from '#store';

// An attachment as it will be posted: where it is read from, and the path the others are given.
export type Attachment = { source: string; target: string };

// Checks every path before anything is copied, so a bad one leaves nothing behind. Paths are
// resolved against cwd (the agent's shell). A file already under files/ is posted as it is.
export function planAttachments({
  paths,
  root,
  handle,
  cwd,
}: {
  paths: string[];
  root: string;
  handle: string;
  cwd: string;
}): Attachment[] {
  const files = filesDir(root);
  // Compared by real path, so a file under files/ is recognized through a symlink (macOS's /tmp).
  const realFiles = fs.realpathSync(files);
  // One folder per post keeps each file's own name, so readers see what it is.
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const folder = path.join(files, `${handle}-${stamp}-${crypto.randomUUID().slice(0, 8)}`);
  const taken = new Set<string>();
  const planned: Attachment[] = [];
  for (const given of paths) {
    const source = path.resolve(cwd, given);
    const real = readableFile(given, source);
    if (planned.some((a) => a.source === source)) {
      continue;
    }
    const target = real.startsWith(`${realFiles}${path.sep}`)
      ? source
      : path.join(folder, freeName(path.basename(source), taken));
    planned.push({ source, target });
  }
  return planned;
}

// Copies what needs copying. Run only once the post is otherwise ready to queue.
export function copyAttachments(attachments: Attachment[]): void {
  for (const { source, target } of attachments) {
    if (source !== target) {
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source, target);
    }
  }
}

// Takes back what copyAttachments copied, when the post was not queued after all. Each post's copies
// have a folder of their own.
export function removeAttachments(attachments: Attachment[]): void {
  for (const { source, target } of attachments) {
    if (source !== target) {
      fs.rmSync(path.dirname(target), { recursive: true, force: true });
    }
  }
}

// The post as queued: its text, then one line per attachment with the path the others read.
export function withAttachments(text: string, attachments: Attachment[]): string {
  if (!attachments.length) {
    return text;
  }
  return `${text.trimEnd()}\n\nAttached:\n${attachments.map((a) => `  ${a.target}`).join('\n')}`;
}

// The file's real path, once it is known to be a readable regular file.
function readableFile(given: string, source: string): string {
  let info: fs.Stats;
  try {
    info = fs.statSync(source);
    fs.accessSync(source, fs.constants.R_OK);
  } catch {
    throw new Error(`Not queued: cannot attach ${given}: no readable file at ${source}.`);
  }
  if (!info.isFile()) {
    throw new Error(
      `Not queued: cannot attach ${given}: it is not a regular file. Attach files one by one.`,
    );
  }
  return fs.realpathSync(source);
}

// notes.md, then notes-2.md, notes-3.md, … for files with the same name in one post.
function freeName(base: string, taken: Set<string>): string {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let name = base;
  for (let n = 2; taken.has(name); n++) {
    name = `${stem}-${n}${ext}`;
  }
  taken.add(name);
  return name;
}
