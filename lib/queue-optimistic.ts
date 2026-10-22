import type { Agent, QueueCommandInput, QueueView } from '@/lib/types';

function isAvailable(agent: Agent) {
  return agent.isActive && agent.status === 'available';
}

function nextAvailable(agents: Agent[], startPosition: number) {
  if (!agents.length) return null;
  const normalized =
    Number.isInteger(startPosition) &&
    startPosition >= 0 &&
    startPosition < agents.length
      ? startPosition
      : 0;
  for (let offset = 0; offset < agents.length; offset += 1) {
    const candidate = agents[(normalized + offset) % agents.length];
    if (isAvailable(candidate)) return candidate;
  }
  return agents[normalized] ?? agents[0] ?? null;
}

function withLiveStats(
  snapshot: QueueView,
  agents: Agent[],
): QueueView['stats'] {
  return {
    ...snapshot.stats,
    todayTotal: agents.reduce((total, agent) => total + agent.todayCount, 0),
    available: agents.filter(isAvailable).length,
    busy: agents.filter((agent) => agent.isActive && agent.status === 'busy')
      .length,
  };
}

export function createOptimisticQueueView(
  snapshot: QueueView,
  input: QueueCommandInput,
): QueueView {
  if (!snapshot.agents.length) return snapshot;

  if (input.type === 'status') {
    const agents = snapshot.agents.map((agent) =>
      agent.id === input.agentId ? { ...agent, status: input.status } : agent,
    );
    const nextAgent = nextAvailable(agents, snapshot.turn.cursorPosition);
    const turnChanged = nextAgent?.id !== snapshot.turn.nextAgentId;
    return {
      ...snapshot,
      agents,
      nextAgent,
      stats: withLiveStats(snapshot, agents),
      turn: turnChanged
        ? {
            ...snapshot.turn,
            sequence: snapshot.turn.sequence + 1,
            nextAgentId: nextAgent?.id ?? null,
            cursorPosition:
              nextAgent?.queuePosition ?? snapshot.turn.cursorPosition,
          }
        : snapshot.turn,
    };
  }

  if (input.type === 'undo-claim') {
    const candidate = snapshot.undoCandidate;
    if (!candidate || candidate.claimEventId !== input.claimEventId) {
      return snapshot;
    }
    const restored = snapshot.agents.find(
      (agent) => agent.id === candidate.agentId,
    );
    if (!restored || !isAvailable(restored)) return snapshot;
    const agents = snapshot.agents.map((agent) =>
      agent.id === restored.id
        ? { ...agent, todayCount: Math.max(0, agent.todayCount - 1) }
        : agent,
    );
    const optimisticRestored =
      agents.find((agent) => agent.id === restored.id) ?? restored;
    return {
      ...snapshot,
      agents,
      nextAgent: optimisticRestored,
      undoCandidate: null,
      stats: withLiveStats(snapshot, agents),
      turn: {
        ...snapshot.turn,
        sequence: snapshot.turn.sequence + 1,
        nextAgentId: optimisticRestored.id,
        cursorPosition: optimisticRestored.queuePosition,
      },
    };
  }

  const current = snapshot.nextAgent;
  if (
    (input.type !== 'claim' && input.type !== 'skip') ||
    !current ||
    current.id !== input.agentId
  ) {
    return snapshot;
  }

  const start = (current.queuePosition + 1) % snapshot.agents.length;
  const agents = snapshot.agents.map((agent) =>
    input.type === 'claim' && agent.id === current.id
      ? { ...agent, todayCount: agent.todayCount + 1 }
      : agent,
  );
  const nextAgent = nextAvailable(agents, start);
  return {
    ...snapshot,
    agents,
    nextAgent,
    stats: withLiveStats(snapshot, agents),
    turn: {
      ...snapshot.turn,
      sequence: snapshot.turn.sequence + 1,
      nextAgentId: nextAgent?.id ?? null,
      cursorPosition: nextAgent?.queuePosition ?? start,
    },
  };
}
