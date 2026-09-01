'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  QueueCommand,
  QueueCommandInput,
  QueueSnapshot,
} from '@/lib/types';

export function useQueue(initialSnapshot: QueueSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [pending, setPending] = useState(false);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/queue', { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível atualizar a fila.');
    const next = (await response.json()) as QueueSnapshot;
    snapshotRef.current = next;
    setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden && !pending) void refresh().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [pending, refresh]);

  const mutate = useCallback(
    async (input: QueueCommandInput) => {
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
        const payload = (await response.json()) as QueueSnapshot & {
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
    },
    [refresh],
  );

  return { snapshot, pending, refresh, mutate };
}
