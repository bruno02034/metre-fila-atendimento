import { env } from 'cloudflare:workers';
import {
  ensureAuthDatabase,
  hashPassword,
  hashSupportPassword,
} from '@/lib/auth-store';
import {
  assertAdminPassword,
  businessDate,
  OFFICIAL_TEAM,
  QueueError,
  reconcileQueueCycle,
} from '@/lib/queue-store';
import type { SessionUser, UserRole } from '@/lib/types';

type RuntimeEnv = { DB: D1Database };
const QUEUE_LOCK_TIMEOUT_MS = 10_000;

export type UserAdminInput = {
  id?: string;
  adminPassword: string;
  name: string;
  login: string;
  password?: string;
  role: UserRole;
  isActive: boolean;
  participatesInQueue: boolean;
  position?: number | null;
};

type ExistingUser = {
  id: string;
  agent_id: string | null;
  name: string;
  login: string;
  role: UserRole;
  is_active: number;
  participates_in_queue: number;
};

function database() {
  return (env as unknown as RuntimeEnv).DB;
}

function cleanName(value: unknown) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 60)
    : '';
}

function cleanLogin(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 60) : '';
}

function slug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function acquireQueueLock() {
  const token = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const staleBefore = new Date(
    Date.now() - QUEUE_LOCK_TIMEOUT_MS,
  ).toISOString();
  const result = await database()
    .prepare(
      `UPDATE queue_state
       SET version = version + 1, lock_token = ?, updated_at = ?
       WHERE id = 1 AND (lock_token IS NULL OR updated_at < ?)`,
    )
    .bind(token, timestamp, staleBefore)
    .run();
  if (Number(result.meta.changes) !== 1) {
    throw new QueueError(
      'Outra alteração está sendo concluída. Tente novamente em instantes.',
      409,
    );
  }
  const state = await database()
    .prepare('SELECT version FROM queue_state WHERE id = 1 AND lock_token = ?')
    .bind(token)
    .first<{ version: number }>();
  if (!state) {
    await releaseQueueLock(token);
    throw new QueueError('Não foi possível reservar a alteração da fila.', 409);
  }
  return { token, version: Number(state.version) };
}

async function releaseQueueLock(token: string) {
  await database()
    .prepare('UPDATE queue_state SET lock_token = NULL WHERE id = 1 AND lock_token = ?')
    .bind(token)
    .run();
}

export async function saveManagedUser(input: UserAdminInput, actor: SessionUser) {
  await ensureAuthDatabase();
  await assertAdminPassword(input.adminPassword);

  const db = database();
  const existing = input.id
    ? await db
        .prepare(
          `SELECT id, agent_id, name, login, role, is_active, participates_in_queue
           FROM app_users WHERE id = ?`,
        )
        .bind(input.id)
        .first<ExistingUser>()
    : null;
  if (input.id && !existing) throw new QueueError('Usuário não encontrado.', 404);

  const official = existing?.agent_id
    ? OFFICIAL_TEAM.find((agent) => agent.id === existing.agent_id)
    : null;
  const requestedName = cleanName(input.name);
  const login = cleanLogin(input.login);
  if (!requestedName || requestedName.length < 2 || !login || !/^[a-z0-9._-]+$/.test(login)) {
    throw new QueueError('Informe nome e login válidos.');
  }

  if (!existing && (input.role !== 'admin' || input.participatesInQueue)) {
    throw new QueueError(
      'A equipe de atendimento é fixa. Novos acessos podem ser apenas administrativos.',
      403,
    );
  }
  if (
    official &&
    (requestedName !== official.name ||
      input.role !== 'support' ||
      !input.participatesInQueue)
  ) {
    throw new QueueError(
      'Nome, perfil e posição dos integrantes da sequência oficial são imutáveis.',
      403,
    );
  }
  if (existing && !official && (input.role !== 'admin' || input.participatesInQueue)) {
    throw new QueueError('Administradores não participam da sequência oficial.', 403);
  }
  if (existing?.id === actor.id && !input.isActive) {
    throw new QueueError('Você não pode desativar o próprio acesso.', 400);
  }

  const duplicate = await db
    .prepare('SELECT id FROM app_users WHERE login = ? AND id <> ?')
    .bind(login, existing?.id ?? '')
    .first<{ id: string }>();
  if (duplicate) throw new QueueError('Esse login já está em uso.', 409);

  const password = typeof input.password === 'string' ? input.password : '';
  if (!existing && !password) throw new QueueError('Defina uma senha para o novo acesso.');
  const passwordHash = password
    ? official
      ? await hashSupportPassword(password)
      : await hashPassword(password)
    : null;
  const timestamp = new Date().toISOString();
  const userId = existing?.id ?? `admin-${slug(requestedName)}-${crypto.randomUUID().slice(0, 6)}`;
  const name = official?.name ?? requestedName;
  const action = existing
    ? passwordHash
      ? 'user_updated_password_reset'
      : 'user_updated'
    : 'user_created';
  const lock = await acquireQueueLock();

  try {
    const statements: D1PreparedStatement[] = [];
    if (existing) {
      statements.push(
        db
          .prepare(
            `UPDATE app_users
             SET name = ?, login = ?, role = ?, is_active = ?,
                 participates_in_queue = ?,
                 password_hash = COALESCE(?, password_hash), updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            name,
            login,
            official ? 'support' : 'admin',
            input.isActive ? 1 : 0,
            official ? 1 : 0,
            passwordHash,
            timestamp,
            existing.id,
          ),
      );
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO app_users
             (id, agent_id, name, login, password_hash, role, is_active,
              participates_in_queue, created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, 'admin', ?, 0, ?, ?)`,
          )
          .bind(
            userId,
            name,
            login,
            passwordHash,
            input.isActive ? 1 : 0,
            timestamp,
            timestamp,
          ),
      );
    }

    if (official && existing?.agent_id) {
      statements.push(
        db
          .prepare(
            `UPDATE support_agents
             SET is_active = ?,
                 status = CASE WHEN ? = 0 THEN 'away'
                               WHEN is_active = 0 THEN 'available'
                               ELSE status END,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            input.isActive ? 1 : 0,
            input.isActive ? 1 : 0,
            timestamp,
            existing.agent_id,
          ),
      );
    }

    statements.push(
      db
        .prepare(
          `INSERT INTO user_audit_log
           (id, user_id, actor_user_id, action, details, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          userId,
          actor.id,
          action,
          JSON.stringify({
            login,
            role: official ? 'support' : 'admin',
            isActive: input.isActive,
            fixedQueueOrder: Boolean(official),
          }),
          timestamp,
        ),
      db
        .prepare(
          `INSERT INTO events
           (id, agent_id, secondary_agent_id, ticket_id, action, details,
            source, business_date, occurred_at)
           VALUES (?, ?, NULL, NULL, ?, ?, 'system', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          existing?.agent_id ?? null,
          action,
          JSON.stringify({
            userId,
            login,
            authorizedBy: 'administrator',
            authorizationMethod: 'password',
            versionAfter: lock.version,
          }),
          businessDate(new Date(timestamp)),
          timestamp,
        ),
    );
    if (existing && (passwordHash || !input.isActive)) {
      statements.push(
        db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(existing.id),
      );
    }
    await db.batch(statements);
  } finally {
    await releaseQueueLock(lock.token);
  }

  await reconcileQueueCycle();
  return { id: userId };
}
