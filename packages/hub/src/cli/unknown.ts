// What to say when an agent guesses a command that doesn't exist. Agents guess from habit: an
// inbox to read, a `send` to post with. The answer teaches the room's model, not just the names.

import { SELF } from '#agent';

const POLL = ['read', 'inbox', 'receive', 'recv', 'wait', 'poll', 'history', 'messages', 'check'];
const POST = ['send', 'post', 'say', 'msg', 'reply', 'tell', 'broadcast', 'chat'];
const WHO = ['members', 'list', 'who', 'whoami', 'ls', 'room', 'rooms', 'info'];

function hint(name: string): string {
  if (POLL.includes(name)) {
    return 'There is no inbox to read: room messages are typed into your pane while you are idle. End your turn instead of waiting or polling.';
  }
  if (POST.includes(name)) {
    return `To post, use message: ${SELF} message --to <handle> --stdin <<'EOF' … EOF`;
  }
  if (WHO.includes(name)) {
    return `Your handle and the members: ${SELF} guide. What waits and why: ${SELF} status.`;
  }
  return '';
}

export function unknownCommand(name: string, commands: string[]): string {
  return [
    `error: unknown command '${name}'.`,
    hint(name.toLowerCase()),
    `Commands: ${commands.join(', ')}. Agents: run \`${SELF} guide\` to learn how to use the room.`,
  ]
    .filter(Boolean)
    .join('\n');
}
