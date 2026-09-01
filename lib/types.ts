export type AgentStatus = 'available' | 'busy' | 'paused' | 'away';
export type UserRole = 'support' | 'admin';

export type SessionUser = {
  id: string;
  agentId: string | null;
  name: string;
  login: string;
  role: UserRole;
  isActive: boolean;
  participatesInQueue: boolean;
  passwordConfigured: boolean;
};

export type ManagedUser = SessionUser & {
  status: AgentStatus | null;
  queuePosition: number | null;
  lastLoginAt: string | null;
  online: boolean;
  createdAt: string;
};

export type Agent = {
  id: string;
  name: string;
  status: AgentStatus;
  isActive: boolean;
  queuePosition: number;
  initialPosition: number;
  todayCount: number;
  online: boolean;
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
  turn: {
    sequence: number;
    nextAgentId: string | null;
    cursorPosition: number;
    startedAt: string;
  };
  stats: {
    todayTotal: number;
    available: number;
    busy: number;
    averageSeconds: number;
  };
};

export type QueueView = QueueSnapshot & {
  viewer: SessionUser;
  turnAlert: {
    key: string | null;
    shouldAlert: boolean;
    acknowledgedAt: string | null;
  };
};

export type QueueCommand = (
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
) & { adminPassword?: string };

export type QueueCommandInput = QueueCommand extends infer Command
  ? Command extends { version: number }
    ? Omit<Command, 'version'>
    : never
  : never;
