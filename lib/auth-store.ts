import { env } from 'cloudflare:workers';
import {
  ensureDatabase,
  OFFICIAL_TEAM,
  reconcileQueueCycle,
} from '@/lib/queue-store';
import type {
  ManagedUser,
  QueueCommand,
  QueueSnapshot,
  QueueView,
  SessionUser,
  UserRole,
} from '@/lib/types';

const SESSION_COOKIE = 'metre_session';
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
// Cloudflare Workers WebCrypto accepts at most 100,000 PBKDF2 iterations.
const PASSWORD_ITERATIONS = 100_000;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;

type RuntimeEnv = {
  DB: D1Database;
  ADMIN_QUEUE_PASSWORD?: string;
  SUPPORT_DEFAULT_PASSWORD?: string;
};

type UserRow = {
  id: string;
  agent_id: string | null;
  name: string;
  login: string;
  password_hash: string | null;
  role: UserRole;
  is_active: number;
  participates_in_queue: number;
  last_login_at: string | null;
  created_at: string;
  status?: string | null;
  queue_position?: number | null;
  last_seen_at?: string | null;
};

let authInitializePromise: Promise<void> | null = null;

function database() {
  return (env as unknown as RuntimeEnv).DB;
}

function nowIso() {
  return new Date().toISOString();
}

const authSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    agent_id TEXT UNIQUE REFERENCES support_agents(id),
    name TEXT NOT NULL,
    login TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT,
    role TEXT NOT NULL CHECK (role IN ('support', 'admin')),
    is_active INTEGER NOT NULL DEFAULT 1,
    participates_in_queue INTEGER NOT NULL DEFAULT 1,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_users(id),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    user_agent TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS user_presence (
    user_id TEXT PRIMARY KEY REFERENCES app_users(id),
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS turn_acknowledgements (
    user_id TEXT NOT NULL REFERENCES app_users(id),
    turn_sequence INTEGER NOT NULL,
    acknowledged_at TEXT NOT NULL,
    PRIMARY KEY (user_id, turn_sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS user_audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES app_users(id),
    actor_user_id TEXT REFERENCES app_users(id),
    action TEXT NOT NULL,
    details TEXT,
    occurred_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_login ON app_users(login)',
  'CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash)',
  'CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_user_audit_user_time ON user_audit_log(user_id, occurred_at)',
];

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function derivePassword(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PASSWORD_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function hashPasswordWithMinimum(password: string, minimumLength: number) {
  if (password.length < minimumLength || password.length > 128) {
    throw new AuthError(
      `A senha deve ter entre ${minimumLength} e 128 caracteres.`,
      400,
    );
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt);
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export function hashPassword(password: string) {
  return hashPasswordWithMinimum(password, 8);
}

export function hashSupportPassword(password: string) {
  return hashPasswordWithMinimum(password, 6);
}

async function secureBytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterations, saltValue, hashValue] = encoded.split('$');
  if (algorithm !== 'pbkdf2_sha256' || Number(iterations) !== PASSWORD_ITERATIONS) {
    return false;
  }
  try {
    const salt = base64ToBytes(saltValue);
    const expected = base64ToBytes(hashValue);
    const actual = await derivePassword(password, salt);
    return secureBytesEqual(actual, expected);
  } catch {
    return false;
  }
}

async function sha256(value: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return bytesToBase64(new Uint8Array(hash));
}

function normalizeLogin(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function loginFromName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.');
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    login: row.login,
    role: row.role,
    isActive: Boolean(row.is_active),
    participatesInQueue: Boolean(row.participates_in_queue),
    passwordConfigured: Boolean(row.password_hash),
  };
}

export async function ensureAuthDatabase() {
  if (!authInitializePromise) {
    authInitializePromise = (async () => {
      await ensureDatabase();
      const db = database();
      await db.batch(authSchemaStatements.map((sql) => db.prepare(sql)));
      const timestamp = nowIso();
      const agents = await db
        .prepare(
          `SELECT id, name, is_active FROM support_agents
           WHERE queue_position BETWEEN 0 AND 9
           ORDER BY queue_position`,
        )
        .all<{ id: string; name: string; is_active: number }>();
      await db.batch(
        agents.results.map((agent) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO app_users
               (id, agent_id, name, login, password_hash, role, is_active,
                participates_in_queue, created_at, updated_at)
               VALUES (?, ?, ?, ?, NULL, 'support', ?, 1, ?, ?)`,
            )
            .bind(
              `user-${agent.id}`,
              agent.id,
              agent.name,
              loginFromName(agent.name),
              agent.is_active,
              timestamp,
              timestamp,
            ),
        ),
      );

      await db.batch(
        OFFICIAL_TEAM.map((agent) =>
          db
            .prepare(
              `UPDATE app_users
               SET name = ?, role = 'support', participates_in_queue = 1,
                   login = CASE WHEN agent_id = 'vitor' AND login = 'vitor'
                                THEN 'victor' ELSE login END,
                   updated_at = ?
               WHERE agent_id = ?`,
            )
            .bind(agent.name, timestamp, agent.id),
        ),
      );

      const admin = await db
        .prepare("SELECT id FROM app_users WHERE login = 'admin'")
        .first<{ id: string }>();
      const adminPassword = (env as unknown as RuntimeEnv).ADMIN_QUEUE_PASSWORD;
      if (!admin && adminPassword) {
        const passwordHash = await hashPassword(adminPassword);
        await db.batch([
          db
            .prepare(
              `INSERT INTO app_users
               (id, agent_id, name, login, password_hash, role, is_active,
                participates_in_queue, created_at, updated_at)
               VALUES ('admin', NULL, 'ADMINISTRADOR', 'admin', ?, 'admin', 1, 0, ?, ?)`,
            )
            .bind(passwordHash, timestamp, timestamp),
          db
            .prepare(
              `INSERT INTO user_audit_log
               (id, user_id, actor_user_id, action, details, occurred_at)
               VALUES (?, 'admin', 'admin', 'user_seeded', ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              JSON.stringify({ login: 'admin', role: 'admin' }),
              timestamp,
            ),
        ]);
      }

      const supportPasswordRolloutId = 'system-support-password-rollout-v1';
      const supportPasswordRollout = await db
        .prepare('SELECT id FROM user_audit_log WHERE id = ?')
        .bind(supportPasswordRolloutId)
        .first<{ id: string }>();
      const supportDefaultPassword = (env as unknown as RuntimeEnv)
        .SUPPORT_DEFAULT_PASSWORD;
      if (!supportPasswordRollout && supportDefaultPassword) {
        const supportPasswordHash = await hashSupportPassword(
          supportDefaultPassword,
        );
        await db.batch([
          db
            .prepare(
              `UPDATE app_users
               SET password_hash = ?, failed_login_attempts = 0,
                   locked_until = NULL, updated_at = ?
               WHERE role = 'support'`,
            )
            .bind(supportPasswordHash, timestamp),
          db.prepare(
            `DELETE FROM auth_sessions
             WHERE user_id IN (SELECT id FROM app_users WHERE role = 'support')`,
          ),
          db
            .prepare(
              `INSERT OR IGNORE INTO user_audit_log
               (id, user_id, actor_user_id, action, details, occurred_at)
               VALUES (?, NULL, 'admin', 'support_passwords_initialized', ?, ?)`,
            )
            .bind(
              supportPasswordRolloutId,
              JSON.stringify({ scope: 'all_support_users' }),
              timestamp,
            ),
        ]);
      }
      await db.prepare('PRAGMA optimize').run();
    })().catch((error) => {
      authInitializePromise = null;
      throw error;
    });
  }
  await authInitializePromise;
}

function parseCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function sessionRecord(cookieHeader: string | null) {
  await ensureAuthDatabase();
  const token = parseCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await database()
    .prepare(
      `SELECT u.id, u.agent_id, u.name, u.login, u.password_hash, u.role,
              u.is_active, u.participates_in_queue, u.last_login_at, u.created_at,
              s.id AS session_id
       FROM auth_sessions s
       JOIN app_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
    )
    .bind(tokenHash, nowIso())
    .first<UserRow & { session_id: string }>();
  return row ?? null;
}

export async function getSessionUserFromCookie(cookieHeader: string | null) {
  const row = await sessionRecord(cookieHeader);
  return row ? toSessionUser(row) : null;
}

export async function requireSession(request: Request) {
  const row = await sessionRecord(request.headers.get('cookie'));
  if (!row) throw new AuthError('Sua sessão expirou. Entre novamente.', 401);
  return toSessionUser(row);
}

export function requireAdmin(user: SessionUser) {
  if (user.role !== 'admin') {
    throw new AuthError('Esta ação exige perfil de administrador.', 403);
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new AuthError('Origem da requisição inválida.', 403);
  }
}

export async function loginUser(login: unknown, password: unknown, request: Request) {
  await ensureAuthDatabase();
  const normalizedLogin = normalizeLogin(login);
  const suppliedPassword = typeof password === 'string' ? password : '';
  const db = database();
  const row = await db
    .prepare(
      `SELECT id, agent_id, name, login, password_hash, role, is_active,
              participates_in_queue, failed_login_attempts, locked_until,
              last_login_at, created_at
       FROM app_users WHERE login = ?`,
    )
    .bind(normalizedLogin)
    .first<
      UserRow & { failed_login_attempts: number; locked_until: string | null }
    >();

  const locked = row?.locked_until && Date.parse(row.locked_until) > Date.now();
  const valid = Boolean(
    row?.is_active &&
      row.password_hash &&
      !locked &&
      (await verifyPassword(suppliedPassword, row.password_hash)),
  );

  if (!valid || !row) {
    if (row && !locked) {
      const failures = Number(row.failed_login_attempts) + 1;
      const lockUntil =
        failures >= MAX_LOGIN_FAILURES
          ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000).toISOString()
          : null;
      await db
        .prepare(
          `UPDATE app_users
           SET failed_login_attempts = ?, locked_until = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(failures >= MAX_LOGIN_FAILURES ? 0 : failures, lockUntil, nowIso(), row.id)
        .run();
    }
    throw new AuthError(
      locked
        ? 'Muitas tentativas. Aguarde 15 minutos para tentar novamente.'
        : 'Login ou senha incorretos.',
      401,
    );
  }

  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000).toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO auth_sessions
         (id, user_id, token_hash, expires_at, created_at, last_seen_at, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        row.id,
        tokenHash,
        expiresAt,
        timestamp,
        timestamp,
        request.headers.get('user-agent')?.slice(0, 240) ?? null,
      ),
    db
      .prepare(
        `UPDATE app_users
         SET failed_login_attempts = 0, locked_until = NULL,
             last_login_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(timestamp, timestamp, row.id),
    db
      .prepare(
        `INSERT INTO user_audit_log
         (id, user_id, actor_user_id, action, details, occurred_at)
         VALUES (?, ?, ?, 'login', NULL, ?)`,
      )
      .bind(crypto.randomUUID(), row.id, row.id, timestamp),
    db
      .prepare(
        `INSERT INTO user_presence (user_id, last_seen_at) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      )
      .bind(row.id, timestamp),
  ];
  if (row.agent_id) {
    statements.push(
      db
        .prepare(
          `INSERT INTO queue_presence (agent_id, last_seen_at) VALUES (?, ?)
           ON CONFLICT(agent_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
        )
        .bind(row.agent_id, timestamp),
    );
  }
  await db.batch(statements);
  if (row.agent_id) await reconcileQueueCycle();

  return { user: toSessionUser(row), token };
}

export async function logoutUser(request: Request) {
  const cookieHeader = request.headers.get('cookie');
  const token = parseCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return;
  await ensureAuthDatabase();
  const tokenHash = await sha256(token);
  const session = await database()
    .prepare('SELECT user_id FROM auth_sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ user_id: string }>();
  const statements = [
    database().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash),
  ];
  if (session) {
    statements.push(
      database()
        .prepare(
          `INSERT INTO user_audit_log
           (id, user_id, actor_user_id, action, details, occurred_at)
           VALUES (?, ?, ?, 'logout', NULL, ?)`,
        )
        .bind(crypto.randomUUID(), session.user_id, session.user_id, nowIso()),
    );
  }
  await database().batch(statements);
}

export async function recordPresence(user: SessionUser) {
  await ensureAuthDatabase();
  const timestamp = nowIso();
  const db = database();
  const statements = [
    db
      .prepare(
        `INSERT INTO user_presence (user_id, last_seen_at) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      )
      .bind(user.id, timestamp),
  ];
  if (user.agentId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO queue_presence (agent_id, last_seen_at) VALUES (?, ?)
           ON CONFLICT(agent_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
        )
        .bind(user.agentId, timestamp),
    );
  }
  await db.batch(statements);
  if (user.agentId) await reconcileQueueCycle();
  return timestamp;
}

export async function acknowledgeTurn(user: SessionUser, sequence: number) {
  await ensureAuthDatabase();
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new AuthError('Alerta de vez inválido.', 400);
  }
  const timestamp = nowIso();
  await database()
    .prepare(
      `INSERT OR IGNORE INTO turn_acknowledgements
       (user_id, turn_sequence, acknowledged_at) VALUES (?, ?, ?)`,
    )
    .bind(user.id, sequence, timestamp)
    .run();
  return timestamp;
}

export async function queueViewForUser(
  user: SessionUser,
  snapshot: QueueSnapshot,
): Promise<QueueView> {
  await ensureAuthDatabase();
  const isOwnTurn = Boolean(
    user.agentId &&
      snapshot.nextAgent?.id === user.agentId &&
      snapshot.turn.nextAgentId === user.agentId,
  );
  const acknowledgement = isOwnTurn
    ? await database()
        .prepare(
          `SELECT acknowledged_at FROM turn_acknowledgements
           WHERE user_id = ? AND turn_sequence = ?`,
        )
        .bind(user.id, snapshot.turn.sequence)
        .first<{ acknowledged_at: string }>()
    : null;
  const events =
    user.role === 'admin'
      ? snapshot.events
      : snapshot.events.filter((event) => event.agentId === user.agentId);
  return {
    ...snapshot,
    events,
    undoCandidate:
      user.role === 'admin' || snapshot.undoCandidate?.agentId === user.agentId
        ? snapshot.undoCandidate
        : null,
    viewer: user,
    turnAlert: {
      key: isOwnTurn ? `${user.id}:${snapshot.turn.sequence}` : null,
      shouldAlert: isOwnTurn && !acknowledgement,
      acknowledgedAt: acknowledgement?.acknowledged_at ?? null,
    },
  };
}

export function authorizeQueueCommand(
  user: SessionUser,
  command: QueueCommand,
  snapshot: QueueSnapshot,
) {
  if (user.role === 'admin') return;
  if (!user.agentId || !user.participatesInQueue) {
    throw new AuthError('Seu usuário não participa da fila.', 403);
  }
  switch (command.type) {
    case 'claim':
    case 'skip':
      if (command.agentId === user.agentId) return;
      break;
    case 'status':
      if (command.agentId === user.agentId) return;
      break;
    case 'undo-claim':
      if (snapshot.undoCandidate?.agentId === user.agentId) return;
      break;
  }
  throw new AuthError('Você não tem permissão para realizar esta ação.', 403);
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  await ensureAuthDatabase();
  const onlineAfter = new Date(Date.now() - 60_000).toISOString();
  const rows = await database()
    .prepare(
      `SELECT u.id, u.agent_id, u.name, u.login, u.password_hash, u.role,
              u.is_active, u.participates_in_queue, u.last_login_at, u.created_at,
              a.status, a.queue_position, p.last_seen_at
       FROM app_users u
       LEFT JOIN support_agents a ON a.id = u.agent_id
       LEFT JOIN user_presence p ON p.user_id = u.id
       ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END,
                COALESCE(a.queue_position, 999999), u.name`,
    )
    .all<UserRow>();
  return rows.results.map((row) => ({
    ...toSessionUser(row),
    status: (row.status as ManagedUser['status']) ?? null,
    queuePosition:
      row.queue_position === null || row.queue_position === undefined
        ? null
        : Number(row.queue_position),
    lastLoginAt: row.last_login_at,
    online: Boolean(row.last_seen_at && row.last_seen_at >= onlineAfter),
    createdAt: row.created_at,
  }));
}
