import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import fs from 'node:fs';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();

let dbInstance = null;
let isPgPool = false;

const schema = `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE providers ADD COLUMN IF NOT EXISTS tenant TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS sgp_config TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS client_accounts (
  cpfcnpj TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chamados (
  id TEXT PRIMARY KEY,
  protocolo TEXT NOT NULL,
  contrato TEXT NOT NULL DEFAULT '',
  cliente TEXT NOT NULL DEFAULT '',
  conteudo TEXT NOT NULL DEFAULT '',
  tipo INTEGER NOT NULL DEFAULT 5,
  tipo_descricao TEXT NOT NULL DEFAULT 'Outros',
  status TEXT NOT NULL DEFAULT 'Em análise',
  data_cadastro TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  monthly_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL,
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function getDb() {
  if (dbInstance) return dbInstance;

  if (databaseUrl) {
    console.log('[Database] Conectando via PostgreSQL Pool (DATABASE_URL)...');
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', error => console.error('[Database] Erro no pool:', error));
    isPgPool = true;
    dbInstance = pool;
  } else {
    const dataDir = path.resolve(process.cwd(), '.data/acesseweb_admin');
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`[Database] Inicializando PostgreSQL Embutido (PGlite) em: ${dataDir}`);
    dbInstance = new PGlite(dataDir);
    isPgPool = false;
  }

  return dbInstance;
}

export async function query(text, values = []) {
  const db = await getDb();
  if (isPgPool) {
    return db.query(text, values);
  }
  const result = await db.query(text, values);
  return {
    rows: result.rows || [],
    rowCount: result.rows ? result.rows.length : 0,
    fields: result.fields || []
  };
}

export async function exec(text) {
  const db = await getDb();
  if (isPgPool) {
    return db.query(text);
  }
  return db.exec(text);
}

export async function transaction(callback) {
  const db = await getDb();
  if (isPgPool) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    return db.transaction(async (tx) => {
      return callback({
        query: (t, v = []) => tx.query(t, v)
      });
    });
  }
}

export async function initializePostgres() {
  try {
    await getDb();
    await exec(schema);
    console.log('[Database] ✅ Schema PostgreSQL inicializado com sucesso.');
  } catch (error) {
    console.error('[Database] ❌ Erro ao inicializar schema:', error);
    throw error;
  }
}
