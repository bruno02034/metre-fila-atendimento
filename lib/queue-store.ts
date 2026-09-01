import { env } from 'cloudflare:workers';
import type {
  Agent,
  AgentStatus,
  OpenTicket,
  QueueCommand,
  QueueEvent,
  QueueSnapshot,
} from '@/lib/types';

export const OFFICIAL_TEAM = [
  { id: 'henrique', name: 'HENRIQUE' },
  { id: 'arthur', name: 'ARTHUR' },
  { id: 'vitor', name: 'VICTOR' },
  { id: 'patrick', name: 'PATRICK' },
  { id: 'pablo', name: 'PABLO' },
  { id: 'bruno', name: 'BRUNO' },
  { id: 'lucas', name: 'LUCAS' },
  { id: 'amaral', name: 'AMARAL' },
  { id: 'antony', name: 'ANTONY' },
  { id: 'jose-carlos', name: 'JOSÉ CARLOS' },
] as const;

const VALID_STATUSES = new Set<AgentStatus>([
  'available',
  'busy',
  'paused',
  'away',
]);
const UNDO_WINDOW_MS = 5 * 60 * 1000;
const ONLINE_WINDOW_MS = 60 * 1000;

type RuntimeEnv = {
  DB: D1Database;
  ADMIN_QUEUE_PASSWORD?: string;
};

type AgentRow = {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: number;
  queue_position: number;
  initial_position: number;
  today_count: number;
  last_seen_at: string | null;
};

type TicketRow = {
  id: string;
  external_id: string | null;
  client: string | null;
  owner_agent_id: string;
  owner_name: string;
  started_at: string;
};

type EventRow = {
  id: string;
  action: string;
  agent_id: string | null;
  agent_name: string | null;
  secondary_agent_name: string | null;
  ticket_id: string | null;
  external_id: string | null;
  details: string | null;
  occurred_at: string;
};

type CycleRow = {
  cursor_position: number;
  sequence: number;
  next_agent_id: string | null;
  started_at: string;
};

let initializePromise: Promise<void> | null = null;

function database() {
  return (env as unknown as RuntimeEnv).DB;
}

function nowIso() {
  return new Date().toISOString();
}

export function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS support_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'busy', 'paused', 'away')),
    is_active INTEGER NOT NULL DEFAULT 1,
    queue_position INTEGER NOT NULL,
    initial_position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS queue_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 0,
    lock_token TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fixed_queue_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cursor_position INTEGER NOT NULL DEFAULT 0,
    sequence INTEGER NOT NULL DEFAULT 0,
    next_agent_id TEXT REFERENCES support_agents(id),
    started_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS queue_presence (
    agent_id TEXT PRIMARY KEY REFERENCES support_agents(id),
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    external_id TEXT,
    client TEXT,
    owner_agent_id TEXT NOT NULL REFERENCES support_agents(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'tiflux')),
    business_date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    closed_at TEXT,
    duration_seconds INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES support_agents(id),
    secondary_agent_id TEXT REFERENCES support_agents(id),
    ticket_id TEXT REFERENCES tickets(id),
    action TEXT NOT NULL,
    details TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'tiflux', 'system')),
    business_date TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_support_agents_name ON support_agents(name)',
  'CREATE INDEX IF NOT EXISTS idx_support_agents_active_queue ON support_agents(is_active, queue_position)',
  'CREATE INDEX IF NOT EXISTS idx_queue_presence_seen ON queue_presence(last_seen_at)',
  'CREATE INDEX IF NOT EXISTS idx_tickets_owner_status ON tickets(owner_agent_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_tickets_business_date ON tickets(business_date)',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_external_open ON tickets(external_id) WHERE external_id IS NOT NULL AND status = 'open'",
  'CREATE INDEX IF NOT EXISTS idx_events_business_date_time ON events(business_date, occurred_at)',
  'CREATE INDEX IF NOT EXISTS idx_events_agent_date ON events(agent_id, business_date)',
];

export async function ensureDatabase() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const db = database();
      await db.batch(schemaStatements.map((sql) => db.prepare(sql)));
      const timestamp = nowIso();
      await db
        .prepare(
          'INSERT OR IGNORE INTO queue_state (id, version, lock_token, updated_at) VALUES (1, 0, NULL, ?)',
        )
        .bind(timestamp)
        .run();

      const existingCycle = await db
        .prepare('SELECT id FROM fixed_queue_state WHERE id = 1')
        .first<{ id: number }>();
      const previousNext = existingCycle
        ? null
        : await db
            .prepare(
              `SELECT id FROM support_agents
               WHERE is_active = 1 AND status = 'available'
               ORDER BY queue_position, created_at LIMIT 1`,
            )
            .first<{ id: string }>();

      await db.batch(
        OFFICIAL_TEAM.map((agent, position) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO support_agents
               (id, name, status, is_active, queue_position, initial_position, created_at, updated_at)
               VALUES (?, ?, 'available', 1, ?, ?, ?, ?)`,
            )
            .bind(agent.id, agent.name, position, position, timestamp, timestamp),
        ),
      );
      await db.batch(
        OFFICIAL_TEAM.map((agent, position) =>
          db
            .prepare(
              `UPDATE support_agents
               SET name = ?, queue_position = ?, initial_position = ?
               WHERE id = ?`,
            )
            .bind(agent.name, position, position, agent.id),
        ),
      );

      const officialIds = OFFICIAL_TEAM.map((agent) => agent.id);
      const placeholders = officialIds.map(() => '?').join(', ');
      await db
        .prepare(
          `UPDATE support_agents SET is_active = 0, status = 'away', updated_at = ?
           WHERE id NOT IN (${placeholders})`,
        )
        .bind(timestamp, ...officialIds)
        .run();

      const migratedPosition = Math.max(
        0,
        OFFICIAL_TEAM.findIndex((agent) => agent.id === previousNext?.id),
      );
      await db
        .prepare(
          `INSERT OR IGNORE INTO fixed_queue_state
           (id, cursor_position, sequence, next_agent_id, started_at)
           VALUES (1, ?, 0, NULL, ?)`,
        )
        .bind(migratedPosition, timestamp)
        .run();
      await db.prepare('PRAGMA optimize').run();
    })().catch((error) => {
      initializePromise = null;
      throw error;
    });
  }
  await initializePromise;
}

function safeJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class QueueError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

async function securePasswordMatch(provided: string, configured: string) {
  const encoder = new TextEncoder();
  const [providedHash, configuredHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(configured)),
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const configuredBytes = new Uint8Array(configuredHash);
  let difference = 0;
  for (let index = 0; index < configuredBytes.length; index += 1) {
    difference |= providedBytes[index] ^ configuredBytes[index];
  }
  return difference === 0;
}

export async function assertAdminPassword(adminPassword: unknown) {
  const configured = (env as unknown as RuntimeEnv).ADMIN_QUEUE_PASSWORD;
  if (!configured) {
    throw new QueueError('A autorização administrativa ainda não foi configurada.', 503);
  }
  if (
    typeof adminPassword !== 'string' ||
    adminPassword.length > 256 ||
    !(await securePasswordMatch(adminPassword, configured))
  ) {
    throw new QueueError('Senha incorreta. Nenhuma alteração foi realizada.', 401);
  }
}

async function acquireLock(expectedVersion: number) {
  const token = crypto.randomUUID();
  const result = await database()
    .prepare(
      `UPDATE queue_state
       SET version = version + 1, lock_token = ?, updated_at = ?
       WHERE id = 1 AND version = ? AND lock_token IS NULL`,
    )
    .bind(token, nowIso(), expectedVersion)
    .run();
  if (Number(result.meta.changes) !== 1) {
    throw new QueueError(
      'A fila mudou enquanto você agia. Os dados já foram atualizados.',
      409,
    );
  }
  return token;
}

async function releaseLock(token: string) {
  await database()
    .prepare('UPDATE queue_state SET lock_token = NULL WHERE id = 1 AND lock_token = ?')
    .bind(token)
    .run();
}

function toAgent(row: AgentRow): Agent {
  const onlineAfter = Date.now() - ONLINE_WINDOW_MS;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    isActive: Boolean(row.is_active),
    queuePosition: Number(row.queue_position),
    initialPosition: Number(row.initial_position),
    todayCount: Number(row.today_count ?? 0),
    online: Boolean(row.last_seen_at && Date.parse(row.last_seen_at) >= onlineAfter),
  };
}

async function loadCycleAgents() {
  const placeholders = OFFICIAL_TEAM.map(() => '?').join(', ');
  const rows = await database()
    .prepare(
      `SELECT a.id, a.name, a.status, a.is_active, a.queue_position,
              a.initial_position, 0 AS today_count, p.last_seen_at
       FROM support_agents a
       LEFT JOIN queue_presence p ON p.agent_id = a.id
       WHERE a.id IN (${placeholders})
       ORDER BY a.queue_position`,
    )
    .bind(...OFFICIAL_TEAM.map((agent) => agent.id))
    .all<AgentRow>();
  return rows.results.map(toAgent);
}

function eligibilityReason(agent: Agent) {
  if (!agent.isActive) return 'inactive';
  if (!agent.online) return 'offline';
  if (agent.status !== 'available') return agent.status;
  return null;
}

function scanAvailable(agents: Agent[], startPosition: number) {
  if (!agents.length) return { target: null as Agent | null, skipped: [] as Agent[] };
  const skipped: Agent[] = [];
  for (let offset = 0; offset < agents.length; offset += 1) {
    const position = (startPosition + offset) % agents.length;
    const agent = agents[position];
    if (!eligibilityReason(agent)) return { target: agent, skipped };
    skipped.push(agent);
  }
  return { target: null as Agent | null, skipped: [] as Agent[] };
}

function eventStatement(
  db: D1Database,
  input: {
    id?: string;
    agentId?: string | null;
    secondaryAgentId?: string | null;
    ticketId?: string | null;
    action: string;
    details?: Record<string, unknown>;
    source?: 'manual' | 'tiflux' | 'system';
    timestamp: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO events
       (id, agent_id, secondary_agent_id, ticket_id, action, details, source, business_date, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id ?? crypto.randomUUID(),
      input.agentId ?? null,
      input.secondaryAgentId ?? null,
      input.ticketId ?? null,
      input.action,
      input.details ? JSON.stringify(input.details) : null,
      input.source ?? 'manual',
      businessDate(new Date(input.timestamp)),
      input.timestamp,
    );
}

function automaticSkipStatements(
  db: D1Database,
  skipped: Agent[],
  target: Agent,
  timestamp: string,
  versionAfter: number,
) {
  return skipped.map((agent) =>
    eventStatement(db, {
      agentId: agent.id,
      secondaryAgentId: target.id,
      action: 'automatic_skip',
      details: {
        reason: eligibilityReason(agent),
        status: agent.status,
        directedTo: target.name,
        fixedPosition: agent.queuePosition,
        versionAfter,
      },
      source: 'system',
      timestamp,
    }),
  );
}

async function reconcileOnce() {
  const db = database();
  const [state, cycle, agents] = await Promise.all([
    db
      .prepare('SELECT version FROM queue_state WHERE id = 1')
      .first<{ version: number }>(),
    db
      .prepare(
        `SELECT cursor_position, sequence, next_agent_id, started_at
         FROM fixed_queue_state WHERE id = 1`,
      )
      .first<CycleRow>(),
    loadCycleAgents(),
  ]);
  if (!state || !cycle || !agents.length) return false;
  const start = Math.max(0, Math.min(cycle.cursor_position, agents.length - 1));
  const { target, skipped } = scanAvailable(agents, start);
  const nextId = target?.id ?? null;
  if (cycle.next_agent_id === nextId) return false;

  const timestamp = nowIso();
  const token = await acquireLock(Number(state.version));
  try {
    const versionAfter = Number(state.version) + 1;
    await db.batch([
      db
        .prepare(
          `UPDATE fixed_queue_state
           SET cursor_position = ?, sequence = sequence + 1,
               next_agent_id = ?, started_at = ?
           WHERE id = 1`,
        )
        .bind(target?.queuePosition ?? start, nextId, timestamp),
      ...(target
        ? automaticSkipStatements(db, skipped, target, timestamp, versionAfter)
        : []),
    ]);
    return true;
  } finally {
    await releaseLock(token);
  }
}

export async function reconcileQueueCycle() {
  await ensureDatabase();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await reconcileOnce();
    } catch (error) {
      if (!(error instanceof QueueError) || error.status !== 409 || attempt === 1) {
        throw error;
      }
    }
  }
  return false;
}

export async function getSnapshot(): Promise<QueueSnapshot> {
  await ensureDatabase();
  await reconcileQueueCycle();
  const db = database();
  const date = businessDate();
  const placeholders = OFFICIAL_TEAM.map(() => '?').join(', ');

  const [stateResult, cycleResult, agentsResult, ticketsResult, eventsResult, statsResult] =
    await Promise.all([
      db
        .prepare('SELECT version, updated_at FROM queue_state WHERE id = 1')
        .first<{ version: number; updated_at: string }>(),
      db
        .prepare(
          `SELECT cursor_position, sequence, next_agent_id, started_at
           FROM fixed_queue_state WHERE id = 1`,
        )
        .first<CycleRow>(),
      db
        .prepare(
          `SELECT a.id, a.name, a.status, a.is_active, a.queue_position,
                  a.initial_position, COALESCE(c.today_count, 0) AS today_count,
                  p.last_seen_at
           FROM support_agents a
           LEFT JOIN queue_presence p ON p.agent_id = a.id
           LEFT JOIN (
             SELECT claim.agent_id, COUNT(*) AS today_count
             FROM events claim
             WHERE claim.action = 'claim'
               AND claim.business_date = ?
               AND NOT EXISTS (
                 SELECT 1 FROM events undo
                 WHERE undo.business_date = claim.business_date
                   AND undo.action = 'undo_claim'
                   AND json_extract(undo.details, '$.claimEventId') = claim.id
               )
             GROUP BY claim.agent_id
           ) c ON c.agent_id = a.id
           WHERE a.id IN (${placeholders})
           ORDER BY a.queue_position`,
        )
        .bind(date, ...OFFICIAL_TEAM.map((agent) => agent.id))
        .all<AgentRow>(),
      db
        .prepare(
          `SELECT t.id, t.external_id, t.client, t.owner_agent_id,
                  a.name AS owner_name, t.started_at
           FROM tickets t
           JOIN support_agents a ON a.id = t.owner_agent_id
           WHERE t.status = 'open'
           ORDER BY t.started_at DESC`,
        )
        .all<TicketRow>(),
      db
        .prepare(
          `SELECT e.id, e.action, e.agent_id, a.name AS agent_name,
                  b.name AS secondary_agent_name, e.ticket_id, t.external_id,
                  e.details, e.occurred_at
           FROM events e
           LEFT JOIN support_agents a ON a.id = e.agent_id
           LEFT JOIN support_agents b ON b.id = e.secondary_agent_id
           LEFT JOIN tickets t ON t.id = e.ticket_id
           WHERE e.business_date = ?
           ORDER BY e.occurred_at DESC, e.rowid DESC
           LIMIT 100`,
        )
        .bind(date)
        .all<EventRow>(),
      db
        .prepare(
          `SELECT COALESCE(AVG(duration_seconds), 0) AS average_seconds
           FROM tickets WHERE business_date = ? AND status = 'closed'`,
        )
        .bind(date)
        .first<{ average_seconds: number }>(),
    ]);

  const agents = agentsResult.results.map(toAgent);
  const events: QueueEvent[] = eventsResult.results.map((row) => ({
    id: row.id,
    action: row.action,
    agentId: row.agent_id,
    agentName: row.agent_name,
    secondaryAgentName: row.secondary_agent_name,
    ticketId: row.ticket_id,
    externalId: row.external_id,
    details: safeJson(row.details),
    occurredAt: row.occurred_at,
  }));
  const openTickets: OpenTicket[] = ticketsResult.results.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    client: row.client,
    ownerAgentId: row.owner_agent_id,
    ownerName: row.owner_name,
    startedAt: row.started_at,
  }));
  const version = Number(stateResult?.version ?? 0);
  const claimEvent = events.find(
    (event) =>
      event.action === 'claim' && Number(event.details?.versionAfter) === version,
  );
  const claimAt = claimEvent ? Date.parse(claimEvent.occurredAt) : Number.NaN;
  const canUndo = Boolean(
    claimEvent?.agentId &&
      claimEvent.agentName &&
      Number.isInteger(claimEvent.details?.previousCursorPosition) &&
      Number.isFinite(claimAt) &&
      Date.now() <= claimAt + UNDO_WINDOW_MS,
  );
  const nextAgent =
    agents.find((agent) => agent.id === cycleResult?.next_agent_id) ?? null;

  return {
    version,
    updatedAt: stateResult?.updated_at ?? nowIso(),
    businessDate: date,
    agents,
    nextAgent,
    openTickets,
    events,
    undoCandidate: canUndo
      ? {
          claimEventId: claimEvent!.id,
          agentId: claimEvent!.agentId as string,
          agentName: claimEvent!.agentName as string,
          expiresAt: new Date(claimAt + UNDO_WINDOW_MS).toISOString(),
        }
      : null,
    turn: {
      sequence: Number(cycleResult?.sequence ?? 0),
      nextAgentId: cycleResult?.next_agent_id ?? null,
      cursorPosition: Number(cycleResult?.cursor_position ?? 0),
      startedAt: cycleResult?.started_at ?? stateResult?.updated_at ?? nowIso(),
    },
    stats: {
      todayTotal: agents.reduce((total, agent) => total + agent.todayCount, 0),
      available: agents.filter((agent) => !eligibilityReason(agent)).length,
      busy: agents.filter((agent) => agent.isActive && agent.status === 'busy').length,
      averageSeconds: Math.round(Number(statsResult?.average_seconds ?? 0)),
    },
  };
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cycleUpdateStatement(
  db: D1Database,
  target: Agent | null,
  fallbackCursor: number,
  timestamp: string,
) {
  return db
    .prepare(
      `UPDATE fixed_queue_state
       SET cursor_position = ?, sequence = sequence + 1,
           next_agent_id = ?, started_at = ?
       WHERE id = 1`,
    )
    .bind(target?.queuePosition ?? fallbackCursor, target?.id ?? null, timestamp);
}

export async function executeCommand(command: QueueCommand) {
  await ensureDatabase();
  if (!Number.isInteger(command.version) || command.version < 0) {
    throw new QueueError('Versão da fila inválida. Atualize a página.');
  }
  const before = await getSnapshot();
  if (before.version !== command.version) {
    throw new QueueError(
      'A fila mudou enquanto você agia. Os dados já foram atualizados.',
      409,
    );
  }

  const db = database();
  const timestamp = nowIso();
  let token: string | null = null;
  try {
    switch (command.type) {
      case 'claim': {
        if (!before.nextAgent || before.nextAgent.id !== command.agentId) {
          throw new QueueError('Esse suporte não é mais o próximo da fila.', 409);
        }
        const start = (before.nextAgent.queuePosition + 1) % before.agents.length;
        const { target, skipped } = scanAvailable(before.agents, start);
        const claimEventId = crypto.randomUUID();
        token = await acquireLock(command.version);
        const versionAfter = command.version + 1;
        await db.batch([
          cycleUpdateStatement(db, target, start, timestamp),
          eventStatement(db, {
            id: claimEventId,
            agentId: command.agentId,
            action: 'claim',
            details: {
              previousCursorPosition: before.turn.cursorPosition,
              previousTurnSequence: before.turn.sequence,
              versionAfter,
            },
            timestamp,
          }),
          ...(target
            ? automaticSkipStatements(db, skipped, target, timestamp, versionAfter)
            : []),
        ]);
        break;
      }
      case 'undo-claim': {
        const candidate = before.undoCandidate;
        const claimEvent = before.events.find(
          (event) => event.id === command.claimEventId && event.action === 'claim',
        );
        if (
          !candidate ||
          candidate.claimEventId !== command.claimEventId ||
          !claimEvent ||
          Date.parse(candidate.expiresAt) < Date.parse(timestamp)
        ) {
          throw new QueueError(
            'Esta retirada não pode mais ser devolvida porque o ciclo mudou ou o prazo expirou.',
            409,
          );
        }
        const previousCursor = Number(claimEvent.details?.previousCursorPosition);
        const restored = before.agents.find((agent) => agent.id === candidate.agentId);
        if (!Number.isInteger(previousCursor) || !restored || eligibilityReason(restored)) {
          throw new QueueError('Não foi possível restaurar essa vez com segurança.', 409);
        }
        token = await acquireLock(command.version);
        await db.batch([
          cycleUpdateStatement(db, restored, previousCursor, timestamp),
          eventStatement(db, {
            agentId: candidate.agentId,
            action: 'undo_claim',
            details: {
              claimEventId: candidate.claimEventId,
              reason: 'retirada_por_engano',
              restoredCursorPosition: previousCursor,
              versionAfter: command.version + 1,
            },
            timestamp,
          }),
        ]);
        break;
      }
      case 'skip': {
        if (!before.nextAgent || before.nextAgent.id !== command.agentId) {
          throw new QueueError('Esse suporte não é mais o próximo da fila.', 409);
        }
        const start = (before.nextAgent.queuePosition + 1) % before.agents.length;
        const { target, skipped } = scanAvailable(before.agents, start);
        token = await acquireLock(command.version);
        const versionAfter = command.version + 1;
        await db.batch([
          cycleUpdateStatement(db, target, start, timestamp),
          eventStatement(db, {
            agentId: command.agentId,
            secondaryAgentId: target?.id ?? null,
            action: 'skip',
            details: {
              reason: cleanText(command.reason, 160) || 'pulo_manual',
              directedTo: target?.name ?? null,
              versionAfter,
            },
            timestamp,
          }),
          ...(target
            ? automaticSkipStatements(db, skipped, target, timestamp, versionAfter)
            : []),
        ]);
        break;
      }
      case 'status': {
        const agent = before.agents.find((item) => item.id === command.agentId);
        if (!agent?.isActive || !VALID_STATUSES.has(command.status)) {
          throw new QueueError('Suporte ou status inválido.');
        }
        const projected = before.agents.map((item) =>
          item.id === agent.id ? { ...item, status: command.status } : item,
        );
        const { target, skipped } = scanAvailable(
          projected,
          before.turn.cursorPosition,
        );
        const turnChanged = target?.id !== before.turn.nextAgentId;
        token = await acquireLock(command.version);
        const versionAfter = command.version + 1;
        await db.batch([
          db
            .prepare('UPDATE support_agents SET status = ?, updated_at = ? WHERE id = ?')
            .bind(command.status, timestamp, command.agentId),
          eventStatement(db, {
            agentId: command.agentId,
            action: 'status_change',
            details: { from: agent.status, to: command.status, versionAfter },
            timestamp,
          }),
          ...(turnChanged
            ? [cycleUpdateStatement(db, target, before.turn.cursorPosition, timestamp)]
            : []),
          ...(turnChanged && target
            ? automaticSkipStatements(db, skipped, target, timestamp, versionAfter)
            : []),
        ]);
        break;
      }
      default:
        throw new QueueError(
          'A ordem oficial é fixa e esta operação não é permitida.',
          403,
        );
    }
  } finally {
    if (token) await releaseLock(token);
  }
  return getSnapshot();
}
