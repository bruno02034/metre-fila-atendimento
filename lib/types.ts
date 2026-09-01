export type AgentStatus = 'available' | 'busy' | 'paused' | 'away';

export type Agent = {
  id: string;
  name: string;
  status: AgentStatus;
  isActive: boolean;
  queuePosition: number;
  initialPosition: number;
  todayCount: number;
};

export type OpenTicket = {
  id: string;
  externalId: string | null;
  client: string | null;
  ownerAgentId: string;
  ownerName: string;
  startedAt: string;
};

export type QueueEvent = {
  id: string;
  action: string;
  agentId: string | null;
  agentName: string | null;
  secondaryAgentName: string | null;
  ticketId: string | null;
  externalId: string | null;
  details: Record<string, unknown> | null;
  occurredAt: string;
};

export type UndoCandidate = {
  claimEventId: string;
  agentId: string;
  agentName: string;
  expiresAt: string;
};

export type QueueSnapshot = {
  version: number;
  updatedAt: string;
  businessDate: string;
  agents: Agent[];
  nextAgent: Agent | null;
  openTickets: OpenTicket[];
  events: QueueEvent[];
  undoCandidate: UndoCandidate | null;
  stats: {
    todayTotal: number;
    available: number;
    busy: number;
    averageSeconds: number;
  };
};

export type QueueCommand =
  | {
      type: 'claim';
      version: number;
      agentId: string;
      externalId?: string;
      client?: string;
    }
  | {
      type: 'undo-claim';
      version: number;
      claimEventId: string;
    }
  | { type: 'skip'; version: number; agentId: string; reason?: string }
  | {
      type: 'status';
      version: number;
      agentId: string;
      status: AgentStatus;
    }
  | { type: 'close'; version: number; ticketId: string }
  | {
      type: 'transfer';
      version: number;
      ticketId: string;
      targetAgentId: string;
    }
  | { type: 'add-agent'; version: number; name: string }
  | {
      type: 'toggle-agent';
      version: number;
      agentId: string;
      isActive: boolean;
    }
  | { type: 'reorder'; version: number; agentIds: string[] }
  | { type: 'reset'; version: number };

export type QueueCommandInput = QueueCommand extends infer Command
  ? Command extends { version: number }
    ? Omit<Command, 'version'>
    : never
  : never;
