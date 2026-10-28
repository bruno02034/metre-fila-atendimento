import assert from 'node:assert/strict';
import test from 'node:test';
import { createOptimisticQueueView } from '../lib/queue-optimistic.ts';

function agent(id, position, status = 'available', todayCount = 0) {
  return {
    id,
    name: id.toUpperCase(),
    status,
    isActive: true,
    queuePosition: position,
    initialPosition: position,
    todayCount,
    online: true,
  };
}

function snapshot() {
  const agents = [
    agent('henrique', 0, 'available', 2),
    agent('arthur', 1, 'busy'),
    agent('vitor', 2),
  ];
  return {
    version: 8,
    updatedAt: '2026-10-22T12:00:00.000Z',
    businessDate: '2026-10-22',
    agents,
    nextAgent: agents[0],
    openTickets: [],
    events: [],
    undoCandidate: {
      claimEventId: 'claim-1',
      agentId: 'henrique',
      agentName: 'HENRIQUE',
      expiresAt: '2026-10-22T12:05:00.000Z',
    },
    turn: {
      sequence: 4,
      nextAgentId: 'henrique',
      cursorPosition: 0,
      startedAt: '2026-10-22T12:00:00.000Z',
    },
    stats: { todayTotal: 2, available: 2, busy: 1, averageSeconds: 0 },
    viewer: {
      id: 'user-henrique',
      agentId: 'henrique',
      name: 'Henrique',
      login: 'henrique',
      role: 'support',
      isActive: true,
      participatesInQueue: true,
      canSkipOthers: false,
      passwordConfigured: true,
    },
    turnAlert: { key: null, shouldAlert: false, acknowledgedAt: null },
  };
}

test('retirada avança imediatamente e ignora indisponíveis', () => {
  const result = createOptimisticQueueView(snapshot(), {
    type: 'claim',
    agentId: 'henrique',
  });
  assert.equal(result.nextAgent.id, 'vitor');
  assert.equal(result.turn.sequence, 5);
  assert.equal(result.agents[0].todayCount, 3);
  assert.equal(result.stats.todayTotal, 3);
  assert.equal(result.version, 8);
});

test('mudança de status recalcula a vez sem alterar a ordem fixa', () => {
  const current = snapshot();
  const result = createOptimisticQueueView(current, {
    type: 'status',
    agentId: 'henrique',
    status: 'away',
  });
  assert.equal(result.nextAgent.id, 'vitor');
  assert.deepEqual(
    result.agents.map((item) => item.queuePosition),
    current.agents.map((item) => item.queuePosition),
  );
  assert.equal(result.stats.available, 1);
  assert.equal(result.turn.cursorPosition, current.turn.cursorPosition);
});

test('suporte disponível novamente recupera a vez antes de qualquer retirada', () => {
  const unavailable = createOptimisticQueueView(snapshot(), {
    type: 'status',
    agentId: 'henrique',
    status: 'away',
  });
  const availableAgain = createOptimisticQueueView(unavailable, {
    type: 'status',
    agentId: 'henrique',
    status: 'available',
  });
  assert.equal(unavailable.nextAgent.id, 'vitor');
  assert.equal(unavailable.turn.cursorPosition, 0);
  assert.equal(availableAgain.nextAgent.id, 'henrique');
  assert.equal(availableAgain.turn.cursorPosition, 0);
});

test('devolução restaura a vez e desfaz a contagem visual', () => {
  const result = createOptimisticQueueView(snapshot(), {
    type: 'undo-claim',
    claimEventId: 'claim-1',
  });
  assert.equal(result.nextAgent.id, 'henrique');
  assert.equal(result.agents[0].todayCount, 1);
  assert.equal(result.undoCandidate, null);
});
