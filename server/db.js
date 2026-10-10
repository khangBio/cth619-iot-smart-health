import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export async function database({ url, file = 'data/health.db' } = {}) {
  let sqlite, pool;
  if (url) {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: url, max: 1 });
  } else {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }
  const sql = (s) => {
    let n = 0;
    return s.replace(/\?/g, () => `$${++n}`);
  };
  const context = new AsyncLocalStorage();
  let tail = Promise.resolve();
  const enqueue = (fn) => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
  const execute = (fn) => (context.getStore() === db ? Promise.resolve().then(fn) : enqueue(fn));
  const rawExec = (s) => (pool ? pool.query(s) : sqlite.exec(s));
  const db = {
    kind: pool ? 'PostgreSQL' : 'SQLite',
    async run(s, p = []) {
      return execute(() => (pool ? pool.query(sql(s), p) : sqlite.prepare(s).run(...p)));
    },
    async all(s, p = []) {
      return execute(async () =>
        pool ? (await pool.query(sql(s), p)).rows : sqlite.prepare(s).all(...p)
      );
    },
    async get(s, p = []) {
      return (await this.all(s, p))[0];
    },
    async exec(s) {
      return execute(() => rawExec(s));
    },
    async transaction(fn) {
      if (context.getStore() === db) return fn();
      return enqueue(() =>
        context.run(db, async () => {
          await rawExec('BEGIN');
          try {
            const result = await fn();
            await rawExec('COMMIT');
            return result;
          } catch (error) {
            await rawExec('ROLLBACK');
            throw error;
          }
        })
      );
    },
    async close() {
      await tail;
      return pool ? pool.end() : sqlite.close();
    },
  };
  await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return db;
}
