'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  QueueCommand,
  QueueCommandInput,
  QueueView,
} from '@/lib/types';

const QUEUE_REFRESH_INTERVAL_MS = 2000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 30000;
const QUEUE_REQUEST_TIMEOUT_MS = 12000;

async function fetchQueue(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    QUEUE_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function useQueue(initialSnapshot: QueueView) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [pending, setPending] = useState(false);
  const snapshotRef = useRef(snapshot);
  const refreshPromiseRef = useRef<Promise<QueueView> | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const refresh = useCallback(async (force = true) => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const refreshPromise = (async () => {
      const versionQuery = force
        ? ''
        : `?version=${encodeURIComponent(snapshotRef.current.version)}`;
      const response = await fetchQueue(`/api/queue${versionQuery}`, {
        cache: 'no-store',
      });
      if (response.status === 401) {
        window.location.assign('/login');
        throw new Error('Sua sessão expirou.');
      }
      if (response.status === 204) return snapshotRef.current;
      if (!response.ok) throw new Error('Não foi possível atualizar a fila.');
      const next = (await response.json()) as QueueView;
      snapshotRef.current = next;
      setSnapshot(next);
      return next;
    })();

    refreshPromiseRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (refreshPromiseRef.current === refreshPromise) {
        refreshPromiseRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      if (!document.hidden && !pending) {
        await refresh(false).catch(() => undefined);
      }
      if (active) timer = window.setTimeout(poll, QUEUE_REFRESH_INTERVAL_MS);
    };

    const refreshWhenVisible = () => {
      if (!document.hidden && !pending) {
        void refresh().catch(() => undefined);
      }
    };

    timer = window.setTimeout(poll, QUEUE_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [pending, refresh]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const heartbeat = async () => {
      if (!document.hidden) {
        const response = await fetchQueue('/api/presence', {
          method: 'POST',
        }).catch(() => null);
        if (response?.status === 401) window.location.assign('/login');
      }
      if (active) {
        timer = window.setTimeout(
          heartbeat,
          PRESENCE_HEARTBEAT_INTERVAL_MS,
        );
      }
    };

    timer = window.setTimeout(heartbeat, PRESENCE_HEARTBEAT_INTERVAL_MS);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  async function mutate(input: QueueCommandInput) {
    setPending(true);
    try {
      const command = {
        ...input,
        version: snapshotRef.current.version,
      } as QueueCommand;
      const response = await fetchQueue('/api/queue', {
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
