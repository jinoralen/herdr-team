// Agent-side commands. They only read/write the database: a post is queued for its recipients right
// away, and the next tick (run by Herdr when an agent changes state, e.g. this one ending its turn)
// delivers it.
// An agent's room is its Herdr workspace, so none of these take a room name.

import fs from 'node:fs';
import { type Definition, definitionFile, loadDefinition } from '@herdr/agents';
import {
  appendLog,
  dbPath,
  filesDir,
  MAX_MESSAGE_CHARS,
  type Member,
  readLog,
  rootDir,
  Store,
  serviceState,
} from '#store';
import { copyAttachments, planAttachments, withAttachments } from './attachments.ts';
import { leadingMention } from './recipients.ts';
import { RetryLater } from './retry.ts';
import { SELF } from './self.ts';
import {
  guestInstructions,
  memberInstructions,
  memberOrientation,
  sanitizeForTerminal,
} from './text.ts';

type CommandOptions = { env?: NodeJS.ProcessEnv };

const REUSABLE_HANDLE = ['gone', 'left', 'rejected'];
// A role, shown to the others in the member list and the "joined" notice; not a place for a brief.
const MAX_DESCRIPTION_CHARS = 200;
const STATUS_LOG_LINES = 20;
// The shape of `status --json`, which compose reads (ADR 0012). Bump it when a field compose may
// read changes or goes away.
const STATUS_JSON_VERSION = 1;
// What --description takes, as the usage lines show it: the agent type first, so the handle
// derived from its first word names the agent.
const ROLE = '"<agent type>, <your role>"';

// A description given where the agent definition goes (the old positional form) is a definition
// nobody wrote: say how to join without one. A definition that exists but is broken gets no hint.
function definitionFor(as: string, env: NodeJS.ProcessEnv): Definition {
  try {
    return loadDefinition(as, { env });
  } catch (error) {
    if (definitionFile(as, { env }) !== null) {
      throw error;
    }
    throw new Error(
      `${(error as Error).message} For an ad-hoc join, use: ${SELF} join --description ${ROLE}`,
    );
  }
}

// HERDR_PANE_ID and HERDR_WORKSPACE_ID are fixed when the agent starts. Membership is matched
// on these launch-time values, so an agent stays in its room even if its pane is moved later.
function caller(env: NodeJS.ProcessEnv): { pane: string; workspace: string } {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID) {
    throw new Error(
      'This command must run inside a Herdr pane (HERDR_PANE_ID / HERDR_WORKSPACE_ID are not set).',
    );
  }
  return { pane: env.HERDR_PANE_ID, workspace: env.HERDR_WORKSPACE_ID };
}

function slug(description: string): string {
  const first = description.trim().split(/[\s,;:/]+/)[0] || '';
  return (
    first
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .replace(/^[-_]+/, '')
      .slice(0, 20) || 'agent'
  );
}

// Ticks are run by the herdr-team Herdr plugin. If none ever ran, posts would wait forever.
function requireInstalled(store: Store): void {
  if (!serviceState(store.root).heartbeat) {
    throw new Error(
      `herdr-team has never run here (${store.root}). Install it as a Herdr plugin: herdr plugin link <herdr-team directory>`,
    );
  }
}

// The first free handle: base, then base-2, base-3, … Handles of members that are gone or were
// rejected are free again once nothing from them waits for delivery.
function freeHandle(store: Store, base: string): string {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const old = store.member(candidate);
    if (!old || (REUSABLE_HANDLE.includes(old.status) && !store.hasQueuedFrom(candidate))) {
      return candidate;
    }
  }
}

// A join waiting for the next tick, which checks with Herdr that an agent runs in the pane.
function newMember(
  description: string,
  pane: string,
  instructions: string | null,
): Omit<Member, 'handle'> {
  return {
    // Shown to the other members by join, guide and status, and in their deliveries.
    description: sanitizeForTerminal(description).trim(),
    pane_id: pane,
    joined_at: new Date().toISOString(),
    status: 'pending',
    terminal_id: null,
    agent: null,
    reason: null,
    held: null,
    // Typed into the agent's pane with its guide, like the description.
    instructions: instructions && sanitizeForTerminal(instructions).trim(),
  };
}

// Records the join and returns the instructions right away. The agent is admitted (or refused, if Herdr
// sees no agent in its pane) by the tick that runs when its turn ends; its posts are delivered after.
// as: an agent definition (name or path) supplying the handle, description and instructions; the
// description and handle given here override it.
export function join({
  as,
  description: given,
  handle,
  env = process.env,
}: CommandOptions & { as?: string; description?: string; handle?: string }): string {
  const definition = as === undefined ? null : definitionFor(as, env);
  const description = given ?? definition?.description ?? '';
  const base = handle ?? definition?.handle ?? slug(description);
  const instructions = definition?.instructions || null;
  if (handle !== undefined && !/^[a-z0-9][a-z0-9_-]{0,19}$/.test(handle)) {
    throw new Error(
      'A handle must be 1–20 lowercase letters, digits, underscores or hyphens, starting with a letter or digit.',
    );
  }
  if (!description?.trim()) {
    throw new Error(`Usage: ${SELF} join <agent>, or ${SELF} join --description ${ROLE}`);
  }
  if (description.trim().length > MAX_DESCRIPTION_CHARS) {
    throw new Error(
      `The description is too long (${description.trim().length} chars, max ${MAX_DESCRIPTION_CHARS}). Give your agent type and a short role, e.g. "codex, reviews for performance".`,
    );
  }
  const { pane, workspace } = caller(env);
  const store = new Store(rootDir(env), workspace);
  requireInstalled(store);

  const joinedHandle = store.transaction(() => {
    // Re-joining from the same pane is idempotent: just print the instructions again.
    const existing = store.memberByPane(pane);
    if (existing) {
      if (handle !== undefined && handle !== existing.handle) {
        throw new Error(
          `This pane already joined as @${existing.handle}. Leave before choosing another handle.`,
        );
      }
      return existing.handle;
    }
    const candidate = freeHandle(store, base);
    if (handle !== undefined && candidate !== handle) {
      throw handleTakenError(store, handle);
    }
    const member = { ...newMember(description, pane, instructions), handle: candidate };
    store.saveMember(member);
    // Queued now, so it comes before anything the agent posts; held until the join is confirmed.
    const id = store.announce(candidate, 'joined', `@${candidate} joined (${member.description}).`);
    appendLog(store.root, store.room, `${id} @${candidate} joined (${member.description}).`);
    return candidate;
  });

  return instructionsFor(store, joinedHandle, true);
}

// An exact handle that isn't free: in use, or free once its old member's posts are delivered.
function handleTakenError(store: Store, handle: string): Error {
  const old = store.member(handle);
  if (old && REUSABLE_HANDLE.includes(old.status)) {
    return new RetryLater(
      `Handle @${handle} still has undelivered posts from its previous member. Retry once they are delivered, or choose another handle.`,
    );
  }
  return new Error(`Handle @${handle} is already in use. Choose another handle.`);
}

function instructionsFor(store: Store, handle: string, justJoined: boolean): string {
  return memberInstructions({
    handle,
    room: store.room,
    members: store.members('active'),
    instructions: store.member(handle)?.instructions ?? null,
    justJoined,
  });
}

// The room's rules: this pane's own (handle, members, wake rule) if it has joined, else the general
// guide. Only reads, so an agent can run it any time, e.g. after its context was compacted.
export function guide({ env = process.env }: CommandOptions = {}): string {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID) {
    return guestInstructions();
  }
  const store = new Store(rootDir(env), env.HERDR_WORKSPACE_ID);
  const member = store.memberByPane(env.HERDR_PANE_ID);
  return member ? instructionsFor(store, member.handle, false) : guestInstructions();
}

// For the top of `--help` in a pane that joined: who it is, and how to post. Empty anywhere else.
// Help must always print, so it never creates the database, and a database it can't read is
// left to the commands that need it.
export function orientation({ env = process.env }: CommandOptions = {}): string {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_WORKSPACE_ID) {
    return '';
  }
  const root = rootDir(env);
  if (!fs.existsSync(dbPath(root))) {
    return '';
  }
  try {
    const store = new Store(root, env.HERDR_WORKSPACE_ID);
    const member = store.memberByPane(env.HERDR_PANE_ID);
    if (!member) {
      return '';
    }
    const others = store
      .members('active')
      .map((m) => m.handle)
      .filter((h) => h !== member.handle);
    return memberOrientation({ handle: member.handle, room: store.room, others });
  } catch {
    return '';
  }
}

// A joined member, or one whose join the next tick will confirm.
function resolveMembership(env: NodeJS.ProcessEnv): { store: Store; member: Member } {
  const { pane, workspace } = caller(env);
  const store = new Store(rootDir(env), workspace);
  const member = store.memberByPane(pane);
  if (!member) {
    const rejected = store.rejectionFor(pane);
    if (rejected) {
      throw new Error(`Your join was refused: ${rejected.reason}`);
    }
    throw new Error(`This pane has not joined the chat. Run: ${SELF} join --description ${ROLE}`);
  }
  return { store, member };
}

// to: the handles from --to; without it, the post goes to every other member.
// re: the id of the message it answers (--re). fyi: no reply needed, so it wakes nobody (--fyi).
// attach: files to copy under files/ and list at the end of the post, resolved against cwd.
export function message({
  text,
  to,
  re,
  fyi = false,
  attach = [],
  cwd = process.cwd(),
  env = process.env,
}: CommandOptions & {
  text: string;
  to?: string[];
  re?: string;
  fyi?: boolean;
  attach?: string[];
  cwd?: string;
}): string {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Message is empty. Pass text or use --stdin.');
  }
  if (text.includes('\0')) {
    throw new Error('Message contains a NUL byte.');
  }
  const { store, member } = resolveMembership(env);
  const attachments = planAttachments({
    paths: attach,
    root: store.root,
    handle: member.handle,
    cwd,
  });
  const post = withAttachments(text, attachments);
  if (post.length > MAX_MESSAGE_CHARS) {
    throw new Error(tooLong(store.root, member.handle, post.length));
  }
  requireInstalled(store);
  const others = store.handles().filter((h) => h !== member.handle);
  const recipients = checkRecipients(to, others);
  const answers = re === undefined ? null : checkRe(store, re);
  copyAttachments(attachments);
  const id = store.enqueue(member.handle, post, recipients, {
    kind: fyi ? 'fyi' : 'message',
    re: answers,
  });
  const tags = [
    answers ? `re ${answers}` : '',
    fyi ? 'fyi' : '',
    attachments.length ? `${attachments.length} attached` : '',
  ]
    .filter(Boolean)
    .join(', ');
  appendLog(
    store.root,
    store.room,
    `${id} @${member.handle} → ${handleList(recipients)}${tags ? ` (${tags})` : ''}: ${preview(text)}`,
  );
  return confirmation({ handle: member.handle, text, to, recipients, others, fyi });
}

// What `message` answers: whom the post is queued for, when it goes out, and a reminder when a post
// to everyone looks meant for one agent.
function confirmation({
  handle,
  text,
  to,
  recipients,
  others,
  fyi,
}: {
  handle: string;
  text: string;
  to: string[] | undefined;
  recipients: string[];
  others: string[];
  fyi: boolean;
}): string {
  const audience =
    to || others.length === 1
      ? handleList(recipients)
      : `all agents in the room: ${handleList(recipients)}`;
  const named = to ? null : leadingMention(text, others);
  const reminder =
    named && others.length > 1
      ? ` Note: it starts with @${named} but has no --to, so everyone gets it; to send only to @${named}, use --to ${named}.`
      : '';
  if (fyi) {
    return `Queued as @${handle} for ${audience}, as FYI: it wakes nobody and arrives with their next message.${reminder}`;
  }
  return `Queued as @${handle} for ${audience}.${reminder} It is sent when you end your turn, so end it now; replies will be delivered to you.`;
}

// `--re m12` (or 12): the id of a message that exists, as m<number>.
function checkRe(store: Store, re: string): string {
  const id = `m${re.trim().replace(/^m/i, '')}`;
  if (!/^m\d+$/.test(id) || !store.wasIssued(id)) {
    throw new Error(
      `Not queued: --re ${re} is not a message id. Use an id from a delivery's header, e.g. --re m12.`,
    );
  }
  return id;
}

// The members a post goes to: those named with --to, or all the others. Refuses a name that isn't
// another member (a typo would otherwise go unnoticed), and a post nobody would get. Joins the next
// tick confirms count too: their posts and deliveries start once it has.
function checkRecipients(to: string[] | undefined, others: string[]): string[] {
  if (!others.length) {
    throw new Error(
      'Not queued: there are no other agents in the room yet, so nobody would get it. Tell your user instead.',
    );
  }
  if (!to) {
    return others;
  }
  const unknown = to.filter((h) => !others.includes(h));
  if (unknown.length || !to.length) {
    throw new Error(
      `Not queued: ${to.length ? `${handleList(unknown)} ${unknown.length === 1 ? 'is' : 'are'} not another member of the room` : '--to names nobody'}. Members: ${handleList(others)}. Fix --to and post again, or leave it out to send to everyone.`,
    );
  }
  return to;
}

// The first line of a message, cut short, for the log.
function preview(text: string): string {
  const first = text.trim().split('\n', 1)[0] ?? '';
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
}

// The way out for content too big to type into a pane: a file the others can read, named for them.
function tooLong(root: string, handle: string, length: number): string {
  // Unique even for several long posts in the same millisecond.
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const file = `${filesDir(root)}/${handle}-${stamp}-${crypto.randomUUID().slice(0, 8)}.md`;
  return `Not queued: the message is too long (${length} chars, max ${MAX_MESSAGE_CHARS}). Save the full text to a file, then post a short summary with the file attached:
    cat > ${file} <<'EOF'
    the full text
    EOF
    ${SELF} message [--to <handle>] --attach ${file} --stdin <<'EOF'
    <a short summary>
    EOF`;
}

const handleList = (handles: string[]): string =>
  handles.length ? handles.map((h) => `@${h}`).join(', ') : 'nobody else';

export function leave({ env = process.env }: CommandOptions = {}): string {
  const { store, member } = resolveMembership(env);
  const id = store.remove(member, 'left', 'left the room');
  if (id) {
    appendLog(store.root, store.room, `${id} @${member.handle} left the room.`);
  }
  return 'You left the room. Nothing more will be delivered to you.';
}

// What the current workspace's room is doing, for debugging: its members, what waits for each, and
// the latest activity. Only reads the database, like the other agent commands.
export function status({
  env = process.env,
  json = false,
}: CommandOptions & { json?: boolean } = {}): string {
  const { workspace } = caller(env);
  const store = new Store(rootDir(env), workspace);
  if (json) {
    return store.transaction(() =>
      JSON.stringify({
        version: STATUS_JSON_VERSION,
        room: workspace,
        members: (['pending', 'active', 'left', 'gone', 'rejected'] as const).flatMap((state) =>
          store.members(state).map((member) => ({
            ...member,
            queuedFrom: store.hasQueuedFrom(member.handle),
          })),
        ),
      }),
    );
  }
  const active = store.members('active');
  const pending = store.members('pending');
  const lines = [
    `Room ${workspace}:`,
    '',
    'Members:',
    ...(active.length || pending.length ? [] : ['  (none)']),
    ...active.map((m) => memberLine(store, m)),
    ...pending.map((m) => `  @${m.handle} — ${m.description} [joining from ${m.pane_id}]`),
    '',
    'Recent activity:',
    ...readLog(store.root, workspace, STATUS_LOG_LINES).map(
      (row) => `  ${new Date(row.at).toLocaleTimeString('en-GB')} ${row.text}`,
    ),
  ];
  if (lines.at(-1) === 'Recent activity:') {
    lines.push('  (none)');
  }
  // Agents can post escape sequences; this is printed in a human's terminal.
  return sanitizeForTerminal(lines.join('\n'));
}

function memberLine(store: Store, m: Member): string {
  const queued = store.queued(m.handle);
  const unsure = queued.filter((q) => q.unsure).map((q) => q.id);
  const notes = [
    queued.length ? `${queued.length} message(s) waiting` : '',
    m.held && queued.length ? `held: ${m.held}` : '',
    unsure.length ? `may not have received ${unsure.join(',')}` : '',
  ].filter(Boolean);
  const extra = notes.length ? `; ${notes.join('; ')}` : '';
  return `  @${m.handle} — ${m.description} [${m.agent}, joined from ${m.pane_id}${extra}]`;
}
