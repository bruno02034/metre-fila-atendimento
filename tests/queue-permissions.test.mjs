import assert from 'node:assert/strict';
import test from 'node:test';
import { canSkipAgent } from '../lib/queue-permissions.ts';

function user(overrides = {}) {
  return {
    id: 'user-lucas',
    agentId: 'lucas',
    name: 'LUCAS',
    login: 'lucas',
    role: 'support',
    isActive: true,
    participatesInQueue: true,
    canSkipOthers: false,
    passwordConfigured: true,
    ...overrides,
  };
}

test('nível padrão pode pular apenas a própria vez', () => {
  assert.equal(canSkipAgent(user(), 'lucas'), true);
  assert.equal(canSkipAgent(user(), 'henrique'), false);
});

test('nível supervisor pode pular a vez de outra pessoa', () => {
  assert.equal(canSkipAgent(user({ canSkipOthers: true }), 'henrique'), true);
});

test('administrador mantém controle total', () => {
  assert.equal(
    canSkipAgent(user({ role: 'admin', agentId: null }), 'henrique'),
    true,
  );
});
