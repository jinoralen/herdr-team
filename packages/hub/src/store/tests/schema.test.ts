import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

test('the embedded schema creates the MVP tables and enforces its trust boundaries', async () => {
  const migration = await Bun.file(
    new URL('../../../drizzle/0000_init.sql', import.meta.url),
  ).text();
  const db = new Database(':memory:');
  try {
    db.exec(migration);
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(['log', 'members', 'queue', 'service']);
    db.exec('INSERT INTO service (id) VALUES (1)');
    expect(() => db.exec('INSERT INTO service (id) VALUES (2)')).toThrow('CHECK constraint');
    expect(() =>
      db.exec(
        "INSERT INTO queue (room, recipient, message_id, sender, kind, text) VALUES ('w1', 'codex', 1, 'claude', 'message', '')",
      ),
    ).toThrow('CHECK constraint');
    expect(() =>
      db.exec(
        "INSERT INTO queue (room, recipient, message_id, sender, kind, text) VALUES ('w1', 'codex', 1, 'claude', 'shout', 'x')",
      ),
    ).toThrow('CHECK constraint');
  } finally {
    db.close();
  }
});
