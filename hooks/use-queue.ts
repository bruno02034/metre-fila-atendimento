'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueCommand, QueueCommandInput, QueueView } from '@/lib/types';
import { createOptimisticQueueView } from '@/lib/queue-optimistic';

const QUEUE_REFRESH_INTERVAL_MS = 10000;
const STREAM_RECONNECT_INTERVAL_MS = 1000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 30000;
const QUEUE_REQUEST_TIMEOUT_MS = 12000;

async function fetchQueue(input: RequestInfo | URL, init?: RequestInit) {
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
  const pendingRef = useRef(false);
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
      if (next.version >= snapshotRef.current.version) {
        snapshotRef.current = next;
        setSnapshot(next);
      }
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
    let source: EventSource | null = null;
    let reconnectTimer: number | undefined;

    const scheduleReconnect = (delay = STREAM_RECONNECT_INTERVAL_MS) => {
      if (!active) return;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const handleServerChange = () => {
      source?.close();
      source = null;
      if (pendingRef.current) {
        scheduleReconnect(250);
        return;
      }
      void refresh(false).finally(() => scheduleReconnect(0));
    };

    function connect() {
      if (!active || document.hidden || pendingRef.current) {
        scheduleReconnect();
        return;
      }
      source?.close();
      source = new EventSource(
        `/api/queue/stream?version=${encodeURIComponent(snapshotRef.current.version)}`,
      );
      source.addEventListener('queue-change', handleServerChange);
      source.addEventListener('reconnect', handleServerChange);
      source.onerror = () => {
        source?.close();
        source = null;
        scheduleReconnect();
      };
    }

    const handleVisibility = () => {
      if (document.hidden) {
        source?.close();
        source = null;
        return;
      }
      scheduleReconnect(0);
    };

    connect();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      active = false;
      source?.close();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

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
        timer = window.setTimeout(heartbeat, PRESENCE_HEARTBEAT_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(heartbeat, PRESENCE_HEARTBEAT_INTERVAL_MS);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  async function mutate(input: QueueCommandInput) {
    const confirmedSnapshot = snapshotRef.current;
    const optimisticSnapshot = createOptimisticQueueView(
      confirmedSnapshot,
      input,
    );
    pendingRef.current = true;
    setPending(true);
    snapshotRef.current = optimisticSnapshot;
    setSnapshot(optimisticSnapshot);
    try {
      const command = {
        ...input,
        version: confirmedSnapshot.version,
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
        snapshotRef.current = confirmedSnapshot;
        setSnapshot(confirmedSnapshot);
        if (response.status === 409) await refresh();
        throw new Error(payload.error || 'A operação não pôde ser concluída.');
      }
      if (payload.version >= snapshotRef.current.version) {
        snapshotRef.current = payload;
        setSnapshot(payload);
      }
      return payload;
    } catch (error) {
      if (snapshotRef.current.version === confirmedSnapshot.version) {
        snapshotRef.current = confirmedSnapshot;
        setSnapshot(confirmedSnapshot);
      }
      throw error;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return { snapshot, pending, refresh, mutate };
}
