import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SESSION_DURATION_SECONDS,
  sessionExpiresAt,
  shouldRenewSession,
} from '../lib/session-policy.ts';

test('sessão persistente dura 30 dias', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z');
  assert.equal(SESSION_DURATION_SECONDS, 30 * 24 * 60 * 60);
  assert.equal(sessionExpiresAt(now), '2026-11-25T12:00:00.000Z');
});

test('sessão antiga de oito horas é renovada no primeiro uso', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z');
  assert.equal(
    shouldRenewSession('2026-10-26T20:00:00.000Z', now),
    true,
  );
});

test('sessão longa só é renovada quando entra na janela final', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z');
  assert.equal(
    shouldRenewSession('2026-11-20T12:00:00.000Z', now),
    false,
  );
  assert.equal(
    shouldRenewSession('2026-11-01T12:00:00.000Z', now),
    true,
  );
});
