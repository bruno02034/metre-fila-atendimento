import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
