'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  QueueCommand,
  QueueCommandInput,
  QueueView,
} from '@/lib/types';

export function useQueue(initialSnapshot: QueueView) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [pending, setPending] = useState(false);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/queue', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.assign('/login');
      throw new Error('Sua sessão expirou.');
    }
    if (!response.ok) throw new Error('Não foi possível atualizar a fila.');
    const next = (await response.json()) as QueueView;
    snapshotRef.current = next;
    setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    const source = new EventSource(`/api/queue/stream?since=${snapshot.version}`);
    source.addEventListener('queue-change', () => {
      if (!pending) void refresh().catch(() => undefined);
      source.close();
    });
    return () => source.close();
  }, [pending, refresh, snapshot.version]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden && !pending) void refresh().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [pending, refresh]);

  useEffect(() => {
    const heartbeat = () =>
      fetch('/api/presence', { method: 'POST' }).catch(() => undefined);
    void heartbeat();
    const interval = window.setInterval(heartbeat, 20000);
    return () => window.clearInterval(interval);
  }, []);

  async function mutate(input: QueueCommandInput) {
      setPending(true);
      try {
        const command = {
          ...input,
          version: snapshotRef.current.version,
        } as QueueCommand;
        const response = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        });
        const payload = (await response.json()) as QueueView & {
          error?: string;
        };
        if (!response.ok) {
          if (response.status === 409) await refresh();
          throw new Error(payload.error || 'A operação não pôde ser concluída.');
        }
        snapshotRef.current = payload;
        setSnapshot(payload);
        return payload;
      } finally {
        setPending(false);
      }
  }

  return { snapshot, pending, refresh, mutate };
}
