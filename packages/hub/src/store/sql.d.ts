// Migration files are imported as text (`with { type: 'text' }`), so they are built into the executable.
declare module '*.sql' {
  const text: string;
  export default text;
}
