import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const supportAgents = sqliteTable(
  'support_agents',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status', {
      enum: ['available', 'busy', 'paused', 'away'],
    })
      .notNull()
      .default('available'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    queuePosition: integer('queue_position').notNull(),
    initialPosition: integer('initial_position').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_support_agents_name').on(table.name),
    index('idx_support_agents_active_queue').on(
      table.isActive,
      table.queuePosition,
    ),
  ],
);

export const queueState = sqliteTable('queue_state', {
  id: integer('id').primaryKey(),
  version: integer('version').notNull().default(0),
  lockToken: text('lock_token'),
  updatedAt: text('updated_at').notNull(),
});

export const fixedQueueState = sqliteTable('fixed_queue_state', {
  id: integer('id').primaryKey(),
  cursorPosition: integer('cursor_position').notNull().default(0),
  sequence: integer('sequence').notNull().default(0),
  nextAgentId: text('next_agent_id').references(() => supportAgents.id),
  startedAt: text('started_at').notNull(),
});

export const queuePresence = sqliteTable(
  'queue_presence',
  {
    agentId: text('agent_id')
      .primaryKey()
      .references(() => supportAgents.id),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [index('idx_queue_presence_seen').on(table.lastSeenAt)],
);

export const appUsers = sqliteTable(
  'app_users',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .unique()
      .references(() => supportAgents.id),
    name: text('name').notNull(),
    login: text('login').notNull(),
    passwordHash: text('password_hash'),
    role: text('role', { enum: ['support', 'admin'] }).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    participatesInQueue: integer('participates_in_queue', { mode: 'boolean' })
      .notNull()
      .default(true),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: text('locked_until'),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_app_users_login').on(table.login)],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => appUsers.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('idx_auth_sessions_token').on(table.tokenHash),
    index('idx_auth_sessions_expiry').on(table.expiresAt),
  ],
);

export const userPresence = sqliteTable('user_presence', {
  userId: text('user_id')
    .primaryKey()
    .references(() => appUsers.id),
  lastSeenAt: text('last_seen_at').notNull(),
});

export const turnAcknowledgements = sqliteTable(
  'turn_acknowledgements',
  {
    userId: text('user_id')
      .notNull()
      .references(() => appUsers.id),
    turnSequence: integer('turn_sequence').notNull(),
    acknowledgedAt: text('acknowledged_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.turnSequence] })],
);

export const userAuditLog = sqliteTable(
  'user_audit_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => appUsers.id),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    details: text('details'),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [index('idx_user_audit_user_time').on(table.userId, table.occurredAt)],
);

export const tickets = sqliteTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    externalId: text('external_id'),
    client: text('client'),
    ownerAgentId: text('owner_agent_id')
      .notNull()
      .references(() => supportAgents.id),
    status: text('status', { enum: ['open', 'closed'] })
      .notNull()
      .default('open'),
    source: text('source', { enum: ['manual', 'tiflux'] })
      .notNull()
      .default('manual'),
    businessDate: text('business_date').notNull(),
    startedAt: text('started_at').notNull(),
    closedAt: text('closed_at'),
    durationSeconds: integer('duration_seconds'),
  },
  (table) => [
    index('idx_tickets_owner_status').on(table.ownerAgentId, table.status),
    index('idx_tickets_business_date').on(table.businessDate),
    uniqueIndex('idx_tickets_external_open')
      .on(table.externalId)
      .where(sql`${table.externalId} IS NOT NULL AND ${table.status} = 'open'`),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').references(() => supportAgents.id),
    secondaryAgentId: text('secondary_agent_id').references(
      () => supportAgents.id,
    ),
    ticketId: text('ticket_id').references(() => tickets.id),
    action: text('action').notNull(),
    details: text('details'),
    source: text('source', { enum: ['manual', 'tiflux', 'system'] })
      .notNull()
      .default('manual'),
    businessDate: text('business_date').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('idx_events_business_date_time').on(
      table.businessDate,
      table.occurredAt,
    ),
    index('idx_events_agent_date').on(table.agentId, table.businessDate),
  ],
);
