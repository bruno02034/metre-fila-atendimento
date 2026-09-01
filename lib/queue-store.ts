import { env } from 'cloudflare:workers';
import type {
  Agent,
  AgentStatus,
  OpenTicket,
  QueueCommand,
  QueueEvent,
  QueueSnapshot,
} from '@/lib/types';

const INITIAL_TEAM = [
  'HENRIQUE',
  'ARTHUR',
  'VITOR',
  'PABLO',
  'BRUNO',
  'LUCAS',
  'AMARAL',
] as const;

const VALID_STATUSES = new Set<AgentStatus>([
  'available',
  'busy',
  'paused',
  'away',
]);

type DatabaseEnv = { DB: D1Database };
let initializePromise: Promise<void> | null = null;

function database() {
  return (env as unknown as DatabaseEnv).DB;
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
      const seeds = INITIAL_TEAM.map((name, index) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO support_agents
             (id, name, status, is_active, queue_position, initial_position, created_at, updated_at)
             VALUES (?, ?, 'available', 1, ?, ?, ?, ?)`,
          )
          .bind(name.toLowerCase(), name, index, index, timestamp, timestamp),
      );
      await db.batch([
        db
          .prepare(
            'INSERT OR IGNORE INTO queue_state (id, version, lock_token, updated_at) VALUES (1, 0, NULL, ?)',
          )
          .bind(timestamp),
        ...seeds,
      ]);
      await db.prepare('PRAGMA optimize').run();
    })().catch((error) => {
      initializePromise = null;
      throw error;
    });
  }
  await initializePromise;
}

type AgentRow = {
  id: string;
  name: string;
  status: AgentStatus;
  is_active: number;
  queue_position: number;
  initial_position: number;
  today_count: number;
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

export async function getSnapshot(): Promise<QueueSnapshot> {
  await ensureDatabase();
  const db = database();
  const date = businessDate();

  const [stateResult, agentsResult, ticketsResult, eventsResult, statsResult] =
    await Promise.all([
      db
        .prepare('SELECT version, updated_at FROM queue_state WHERE id = 1')
        .first<{ version: number; updated_at: string }>(),
      db
        .prepare(
          `SELECT a.id, a.name, a.status, a.is_active, a.queue_position,
                  a.initial_position, COALESCE(c.today_count, 0) AS today_count
           FROM support_agents a
           LEFT JOIN (
             SELECT agent_id, COUNT(*) AS today_count
             FROM events
             WHERE action = 'claim' AND business_date = ?
             GROUP BY agent_id
           ) c ON c.agent_id = a.id
           ORDER BY a.queue_position, a.created_at`,
        )
        .bind(date)
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
           ORDER BY e.occurred_at DESC
           LIMIT 60`,
        )
        .bind(date)
        .all<EventRow>(),
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM events WHERE action = 'claim' AND business_date = ?) AS today_total,
             (SELECT COUNT(*) FROM support_agents WHERE is_active = 1 AND status = 'available') AS available,
             (SELECT COUNT(*) FROM support_agents WHERE is_active = 1 AND status = 'busy') AS busy,
             COALESCE((SELECT AVG(duration_seconds) FROM tickets WHERE business_date = ? AND status = 'closed'), 0) AS average_seconds`,
        )
        .bind(date, date)
        .first<{
          today_total: number;
          available: number;
          busy: number;
          average_seconds: number;
        }>(),
    ]);

  const agents: Agent[] = agentsResult.results.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    isActive: Boolean(row.is_active),
    queuePosition: Number(row.queue_position),
    initialPosition: Number(row.initial_position),
    todayCount: Number(row.today_count),
  }));

  const openTickets: OpenTicket[] = ticketsResult.results.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    client: row.client,
    ownerAgentId: row.owner_agent_id,
    ownerName: row.owner_name,
    startedAt: row.started_at,
  }));

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

  return {
    version: Number(stateResult?.version ?? 0),
    updatedAt: stateResult?.updated_at ?? nowIso(),
    businessDate: date,
    agents,
    nextAgent:
      agents.find((agent) => agent.isActive && agent.status === 'available') ??
      null,
    openTickets,
    events,
    stats: {
      todayTotal: Number(statsResult?.today_total ?? 0),
      available: Number(statsResult?.available ?? 0),
      busy: Number(statsResult?.busy ?? 0),
      averageSeconds: Math.round(Number(statsResult?.average_seconds ?? 0)),
    },
  };
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

async function acquireLock(expectedVersion: number) {
  const db = database();
  const token = crypto.randomUUID();
  const result = await db
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

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function eventStatement(
  db: D1Database,
  input: {
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
      crypto.randomUUID(),
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
  const date = businessDate(new Date(timestamp));
  const maxPosition = Math.max(-1, ...before.agents.map((agent) => agent.queuePosition));
  let token: string | null = null;

  try {
    switch (command.type) {
      case 'claim': {
        if (!before.nextAgent || before.nextAgent.id !== command.agentId) {
          throw new QueueError('Esse suporte não é mais o próximo da fila.', 409);
        }
        const ticketId = crypto.randomUUID();
        const externalId = cleanText(command.externalId, 80).toUpperCase() || null;
        const client = cleanText(command.client, 120) || null;
        token = await acquireLock(command.version);
        await db.batch([
          db
            .prepare(
              "UPDATE support_agents SET status = 'busy', queue_position = ?, updated_at = ? WHERE id = ? AND is_active = 1",
            )
            .bind(maxPosition + 1, timestamp, command.agentId),
          db
            .prepare(
              `INSERT INTO tickets
               (id, external_id, client, owner_agent_id, status, source, business_date, started_at)
               VALUES (?, ?, ?, ?, 'open', 'manual', ?, ?)`,
            )
            .bind(ticketId, externalId, client, command.agentId, date, timestamp),
          eventStatement(db, {
            agentId: command.agentId,
            ticketId,
            action: 'claim',
            details: { externalId, client },
            timestamp,
          }),
        ]);
        break;
      }
      case 'skip': {
        if (!before.nextAgent || before.nextAgent.id !== command.agentId) {
          throw new QueueError('Esse suporte não é mais o próximo da fila.', 409);
        }
        const reason = cleanText(command.reason, 160) || null;
        token = await acquireLock(command.version);
        await db.batch([
          db
            .prepare(
              'UPDATE support_agents SET queue_position = ?, updated_at = ? WHERE id = ? AND is_active = 1',
            )
            .bind(maxPosition + 1, timestamp, command.agentId),
          eventStatement(db, {
            agentId: command.agentId,
            action: 'skip',
            details: { reason },
            timestamp,
          }),
        ]);
        break;
      }
      case 'status': {
        const agent = before.agents.find((item) => item.id === command.agentId);
        if (!agent?.isActive || !VALID_STATUSES.has(command.status)) {
          throw new QueueError('Suporte ou status inválido.');
        }
        if (
          command.status === 'available' &&
          before.openTickets.some((ticket) => ticket.ownerAgentId === agent.id)
        ) {
          throw new QueueError(
            'Encerre ou transfira os atendimentos antes de marcar como disponível.',
          );
        }
        token = await acquireLock(command.version);
        await db.batch([
          db
            .prepare('UPDATE support_agents SET status = ?, updated_at = ? WHERE id = ?')
            .bind(command.status, timestamp, command.agentId),
          eventStatement(db, {
            agentId: command.agentId,
            action: 'status_change',
            details: { from: agent.status, to: command.status },
            timestamp,
          }),
        ]);
        break;
      }
      case 'close': {
        const ticket = before.openTickets.find((item) => item.id === command.ticketId);
        if (!ticket) throw new QueueError('Atendimento já encerrado ou não encontrado.', 409);
        const duration = Math.max(
          0,
          Math.round((Date.parse(timestamp) - Date.parse(ticket.startedAt)) / 1000),
        );
        token = await acquireLock(command.version);
        await db.batch([
          db
            .prepare(
              `UPDATE tickets
               SET status = 'closed', closed_at = ?, duration_seconds = ?
               WHERE id = ? AND status = 'open'`,
            )
            .bind(timestamp, duration, ticket.id),
          db
            .prepare(
              `UPDATE support_agents SET status = 'available', updated_at = ?
               WHERE id = ?
                 AND NOT EXISTS (
                   SELECT 1 FROM tickets
                   WHERE owner_agent_id = ? AND status = 'open' AND id <> ?
                 )`,
            )
            .bind(timestamp, ticket.ownerAgentId, ticket.ownerAgentId, ticket.id),
          eventStatement(db, {
            agentId: ticket.ownerAgentId,
            ticketId: ticket.id,
            action: 'close',
            details: { durationSeconds: duration },
            timestamp,
          }),
        ]);
        break;
      }
      case 'transfer': {
        const ticket = before.openTickets.find((item) => item.id === command.ticketId);
        const target = before.agents.find((item) => item.id === command.targetAgentId);
        if (!ticket) throw new QueueError('Atendimento já encerrado ou não encontrado.', 409);
        if (!target?.isActive || target.id === ticket.ownerAgentId) {
          throw new QueueError('Escolha outro suporte ativo para a transferência.');
        }
        token = await acquireLock(command.version);
        await db.batch([
          db
            .prepare("UPDATE tickets SET owner_agent_id = ? WHERE id = ? AND status = 'open'")
            .bind(target.id, ticket.id),
          db
            .prepare(
              `UPDATE support_agents SET status = 'available', updated_at = ?
               WHERE id = ?
                 AND NOT EXISTS (
                   SELECT 1 FROM tickets
                   WHERE owner_agent_id = ? AND status = 'open' AND id <> ?
                 )`,
            )
            .bind(timestamp, ticket.ownerAgentId, ticket.ownerAgentId, ticket.id),
          db
            .prepare("UPDATE support_agents SET status = 'busy', updated_at = ? WHERE id = ?")
            .bind(timestamp, target.id),
          eventStatement(db, {
            agentId: ticket.ownerAgentId,
            secondaryAgentId: target.id,
            ticketId: ticket.id,
            action: 'transfer',
            timestamp,
          }),
        ]);
        break;
      }
      case 'add-agent': {
        const name = cleanText(command.name, 60).replace(/\s+/g, ' ').toUpperCase();
        if (name.length < 2) throw new QueueError('Informe um nome válido.');
        if (before.agents.some((agent) => agent.name === name)) {
          throw new QueueError('Já existe um suporte com esse nome.');
        }
        const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto
          .randomUUID()
          .slice(0, 6)}`;
        const nextInitial = Math.max(-1, ...before.agents.map((a) => a.initialPosition)) + 1;
        token = await acquireLock(command.version);
        await db.batch([
          db
            .prepare(
              `INSERT INTO support_agents
               (id, name, status, is_active, queue_position, initial_position, created_at, updated_at)
               VALUES (?, ?, 'available', 1, ?, ?, ?, ?)`,
            )
            .bind(id, name, maxPosition + 1, nextInitial, timestamp, timestamp),
          eventStatement(db, {
            agentId: id,
            action: 'agent_added',
            source: 'system',
            timestamp,
          }),
        ]);
        break;
      }
      case 'toggle-agent': {
        const agent = before.agents.find((item) => item.id === command.agentId);
        if (!agent) throw new QueueError('Suporte não encontrado.');
        if (
          !command.isActive &&
          before.openTickets.some((ticket) => ticket.ownerAgentId === agent.id)
        ) {
          throw new QueueError('Transfira ou encerre os atendimentos antes de desativar.');
        }
        token = await acquireLock(command.version);
        await db.batch([
          db
            .prepare(
              `UPDATE support_agents
               SET is_active = ?, status = ?, updated_at = ?
               WHERE id = ?`,
            )
            .bind(
              command.isActive ? 1 : 0,
              command.isActive ? 'available' : 'away',
              timestamp,
              agent.id,
            ),
          eventStatement(db, {
            agentId: agent.id,
            action: command.isActive ? 'agent_activated' : 'agent_deactivated',
            source: 'system',
            timestamp,
          }),
        ]);
        break;
      }
      case 'reorder': {
        const activeIds = before.agents.filter((agent) => agent.isActive).map((agent) => agent.id);
        if (
          command.agentIds.length !== activeIds.length ||
          new Set(command.agentIds).size !== activeIds.length ||
          command.agentIds.some((id) => !activeIds.includes(id))
        ) {
          throw new QueueError('A lista de reordenação não corresponde à equipe ativa.', 409);
        }
        token = await acquireLock(command.version);
        await db.batch([
          ...command.agentIds.map((id, index) =>
            db
              .prepare('UPDATE support_agents SET queue_position = ?, updated_at = ? WHERE id = ?')
              .bind(index, timestamp, id),
          ),
          eventStatement(db, {
            action: 'queue_reordered',
            details: { agentIds: command.agentIds },
            source: 'system',
            timestamp,
          }),
        ]);
        break;
      }
      case 'reset': {
        const active = before.agents
          .filter((agent) => agent.isActive)
          .sort((a, b) => a.initialPosition - b.initialPosition);
        token = await acquireLock(command.version);
        await db.batch([
          ...active.map((agent, index) =>
            db
              .prepare('UPDATE support_agents SET queue_position = ?, updated_at = ? WHERE id = ?')
              .bind(index, timestamp, agent.id),
          ),
          eventStatement(db, {
            action: 'queue_reset',
            source: 'system',
            timestamp,
          }),
        ]);
        break;
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: tickets\.external_id/i.test(error.message)
    ) {
      throw new QueueError('Esse ticket já está em atendimento.', 409);
    }
    throw error;
  } finally {
    if (token) await releaseLock(token);
  }

  return getSnapshot();
}
