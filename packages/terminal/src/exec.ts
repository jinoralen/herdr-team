// Every external command hub and compose run goes through an Exec: the real one starts a process,
// and tests pass one that answers in-process with the output the real command prints.

export type Exited = { exitCode: number; stdout: string; stderr: string; timedOut: boolean };
// A missing executable rejects with the spawn error (code ENOENT), as Bun.spawn throws it.
type ExecOptions = { env: NodeJS.ProcessEnv; timeout?: number };
export type Exec = (argv: string[], options: ExecOptions) => Promise<Exited>;

export async function spawnExec(argv: string[], { env, timeout }: ExecOptions): Promise<Exited> {
  // An argv array, never a shell: text is passed as a single argv entry.
  const proc = Bun.spawn(argv, {
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout,
    killSignal: 'SIGKILL',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // The timeout ends the process with SIGKILL. Not proc.killed: Bun sets it after any exit.
  const timedOut = timeout !== undefined && proc.signalCode === 'SIGKILL';
  return { exitCode, stdout, stderr, timedOut };
}
