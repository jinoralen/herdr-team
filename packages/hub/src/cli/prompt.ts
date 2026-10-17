// Keeps the member guide ahead of the user's initial task in both startup modes.
import { sanitizeForTerminal } from '#agent';

// Leave room for the guide below Linux's 128 KiB limit for a single argv entry.
const MAX_TASK_BYTES = 80_000;
const MAX_PROMPT_BYTES = 100_000;

export function initialTask(prompt: string | undefined): string {
  if (prompt === undefined) {
    return "Wait for your user's task.";
  }
  const text = sanitizeForTerminal(prompt).trim();
  if (!text) {
    throw new Error('The initial prompt is empty. Provide a task or omit --prompt.');
  }
  if (Buffer.byteLength(text) > MAX_TASK_BYTES) {
    throw new Error('The initial prompt exceeds 80 KB. Shorten it or refer to a file.');
  }
  return `Your initial task:\n${text}`;
}

export function memberPrompt(guide: string, task: string): string {
  const prompt = `${guide}\n\n${task}`;
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) {
    throw new Error(
      'The room guide and initial prompt exceed 100 KB. Shorten the prompt or refer to a file.',
    );
  }
  return prompt;
}
