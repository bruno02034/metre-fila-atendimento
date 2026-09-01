'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellRing, Check, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { QueueView } from '@/lib/types';

export function TurnAlertCenter({
  view,
  onRefresh,
}: {
  view: QueueView;
  onRefresh: () => Promise<unknown>;
}) {
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [mutedTurnKey, setMutedTurnKey] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<OscillatorNode[]>([]);
  const turnKey = view.turnAlert.key;
  const mutedForTurn = Boolean(turnKey && mutedTurnKey === turnKey);

  const stopSound = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // The short chime may already have ended.
      }
    }
    activeSourcesRef.current = [];
  }, []);

  const playChime = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || context.state !== 'running') return;
    stopSound();
    const start = context.currentTime;
    const notes = [659.25, 783.99, 987.77];
    activeSourcesRef.current = notes.map((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = start + index * 0.34;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.16, noteStart + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.24);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.25);
      return oscillator;
    });
    window.setTimeout(() => {
      activeSourcesRef.current = [];
    }, 1400);
  }, [stopSound]);

  async function activateAlerts() {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) {
      setAlertsEnabled(false);
      return;
    }
    const context = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = context;
    await context.resume();
    setAlertsEnabled(context.state === 'running');
    window.localStorage.setItem('metre-alerts-enabled', '1');
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => 'default');
    }
  }

  useEffect(() => {
    stopSound();
  }, [stopSound, turnKey]);

  useEffect(() => {
    if (!turnKey || !view.turnAlert.shouldAlert || !alertsEnabled || mutedForTurn) {
      return;
    }
    const storageKey = `metre-alerted:${turnKey}`;
    if (window.localStorage.getItem(storageKey)) return;
    window.localStorage.setItem(storageKey, new Date().toISOString());
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('metre-turn-alerts') : null;
    channel?.postMessage({ type: 'played', turnKey });
    channel?.close();
    playChime();
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('É SUA VEZ!', {
        body: 'Você é o próximo a pegar atendimento.',
        icon: '/metre-logo.png',
        tag: turnKey,
      });
    }
  }, [alertsEnabled, mutedForTurn, playChime, turnKey, view.turnAlert.shouldAlert]);

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('metre-turn-alerts');
    channel.onmessage = (event) => {
      if (event.data?.type === 'played' && event.data.turnKey) {
        window.localStorage.setItem(
          `metre-alerted:${event.data.turnKey}`,
          new Date().toISOString(),
        );
        if (event.data.turnKey === turnKey) stopSound();
      }
    };
    return () => channel.close();
  }, [stopSound, turnKey]);

  useEffect(() => () => stopSound(), [stopSound]);

  async function acknowledge() {
    setAcknowledging(true);
    stopSound();
    try {
      const response = await fetch('/api/alerts/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence: view.turn.sequence }),
      });
      if (!response.ok) throw new Error('Não foi possível reconhecer o alerta.');
      await onRefresh();
    } finally {
      setAcknowledging(false);
    }
  }

  if (!view.turnAlert.shouldAlert) {
    return (
      <div className="mb-4 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className={alertsEnabled ? 'text-[var(--brand)]' : ''}
          onClick={() => void activateAlerts()}
        >
          {alertsEnabled ? <BellRing /> : <Bell />}
          {alertsEnabled ? 'Alertas ativos' : 'Ativar alertas'}
        </Button>
      </div>
    );
  }

  return (
    <section className="mb-4 overflow-hidden rounded-3xl bg-[var(--brand)] text-white shadow-[0_18px_50px_rgb(194_70_26/24%)]">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15">
            <BellRing className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
              Alerta da fila
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">É SUA VEZ!</h2>
            <p className="mt-1 text-sm text-white/75">
              Você é o próximo a pegar atendimento.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!alertsEnabled ? (
            <Button variant="outline" className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => void activateAlerts()}>
              <Volume2 />
              Ativar som
            </Button>
          ) : (
            <Button
              variant="outline"
              className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => {
                stopSound();
                setMutedTurnKey(turnKey);
              }}
            >
              <VolumeX />
              Parar som
            </Button>
          )}
          <Button className="bg-white text-[var(--brand)] hover:bg-white/90" disabled={acknowledging} onClick={() => void acknowledge()}>
            <Check />
            {acknowledging ? 'Salvando…' : 'Entendi'}
          </Button>
        </div>
      </div>
    </section>
  );
}
