'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Headphones,
  History,
  LayoutDashboard,
  LogOut,
  PauseCircle,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trophy,
  Undo2,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TurnAlertCenter } from '@/components/turn-alert-center';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toaster, toast } from '@/components/ui/toast';
import { useQueue } from '@/hooks/use-queue';
import type {
  Agent,
  AgentStatus,
  QueueCommandInput,
  QueueEvent,
  QueueView,
} from '@/lib/types';

const statusMeta: Record<AgentStatus, { label: string; className: string }> = {
  available: {
    label: 'Disponível',
    className: 'status-available',
  },
  busy: { label: 'Ocupado', className: 'status-busy' },
  paused: { label: 'Pausado', className: 'status-paused' },
  away: { label: 'Ausente', className: 'status-away' },
};

const actionLabels: Record<string, string> = {
  claim: 'Pegou atendimento',
  undo_claim: 'Devolveu o atendimento',
  skip: 'Pulou a vez',
  automatic_skip: 'Foi pulado automaticamente',
  status_change: 'Alterou o status',
  close: 'Encerrou atendimento',
  transfer: 'Transferiu atendimento',
  user_created: 'Criou um acesso',
  user_updated: 'Atualizou um acesso',
  user_updated_password_reset: 'Redefiniu uma senha',
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function eventDescription(event: QueueEvent) {
  if (event.action === 'undo_claim') {
    return 'Voltou para sua vez na fila';
  }
  if (event.action === 'automatic_skip') {
    const reasonLabels: Record<string, string> = {
      busy: 'estava ocupado',
      paused: 'estava pausado',
      away: 'estava ausente',
      offline: 'estava offline',
      inactive: 'estava inativo',
    };
    const reason =
      reasonLabels[String(event.details?.reason)] ?? 'estava indisponível';
    return event.secondaryAgentName
      ? `${reason}; atendimento direcionado para ${event.secondaryAgentName}`
      : reason;
  }
  const auditLabel =
    event.details?.authorizedBy === 'administrator'
      ? 'Alteração manual autorizada por administrador'
      : '';
  if (event.action === 'transfer' && event.secondaryAgentName) {
    return [`para ${event.secondaryAgentName}`, auditLabel]
      .filter(Boolean)
      .join(' · ');
  }
  if (event.externalId) {
    return [event.externalId, auditLabel].filter(Boolean).join(' · ');
  }
  if (event.action === 'status_change' && event.details?.to) {
    return [
      statusMeta[event.details.to as AgentStatus]?.label ?? '',
      auditLabel,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return auditLabel;
}

export function DashboardClient({
  initialSnapshot,
}: {
  initialSnapshot: QueueView;
}) {
  const { snapshot, pending, refresh, mutate } = useQueue(initialSnapshot);
  const [undoOpen, setUndoOpen] = useState(false);
  const viewer = snapshot.viewer;
  const viewerAgent = snapshot.agents.find(
    (agent) => agent.id === viewer.agentId,
  );
  const hasAvailableAgent = snapshot.stats.available > 0;
  const canOperateNext =
    hasAvailableAgent &&
    (viewer.role === 'admin' || snapshot.nextAgent?.id === viewer.agentId);

  const cycleAgents = snapshot.agents;
  const ranking = useMemo(
    () =>
      [...cycleAgents].sort(
        (a, b) =>
          b.todayCount - a.todayCount || a.queuePosition - b.queuePosition,
      ),
    [cycleAgents],
  );

  async function run(input: QueueCommandInput, success: string) {
    try {
      await mutate(input);
      toast.add({ title: success, type: 'success' });
    } catch (error) {
      toast.add({
        title: 'Atenção',
        description:
          error instanceof Error ? error.message : 'Tente novamente.',
        type: 'error',
      });
      throw error;
    }
  }

  async function changeStatus(agent: Agent, status: AgentStatus) {
    if (agent.status === status) return;
    try {
      await run(
        { type: 'status', agentId: agent.id, status },
        `${agent.name} está ${statusMeta[status].label.toLowerCase()}`,
      );
    } catch {
      // Feedback is shown by the shared toast.
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Toaster />
      <header className="border-b border-white/10 bg-[var(--navy)] text-white">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a
            href="/"
            className="flex items-center gap-3"
            aria-label="Ir para o painel"
          >
            <img
              src="/metre-logo.png"
              alt=""
              className="size-11 shrink-0 object-contain drop-shadow-[0_6px_16px_rgb(194_70_26/25%)]"
            />
            <div>
              <p className="font-semibold leading-none tracking-tight">Metre</p>
              <p className="mt-1 text-[11px] text-white/55">
                Fila de atendimento
              </p>
            </div>
          </a>
          <nav
            className="flex items-center gap-1"
            aria-label="Navegação principal"
          >
            <span className="hidden px-3 text-xs text-white/65 md:inline">
              Olá,{' '}
              <strong className="font-medium text-white">{viewer.name}</strong>
              {viewerAgent
                ? ` · ${viewerAgent.queuePosition + 1}ª posição fixa`
                : ''}
            </span>
            <a
              href="/"
              className="hidden items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium sm:flex"
            >
              <LayoutDashboard className="size-3.5" />
              Operação
            </a>
            {viewer.role === 'admin' ? (
              <a
                href="/admin"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Settings2 className="size-3.5" />
                Administração
              </a>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="ml-1 text-white/65 hover:bg-white/10 hover:text-white"
              aria-label="Atualizar painel"
              disabled={pending}
              onClick={() => void refresh()}
            >
              <RefreshCw className={pending ? 'animate-spin' : ''} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white/65 hover:bg-white/10 hover:text-white"
              aria-label="Sair"
              onClick={() => void logout()}
            >
              <LogOut />
            </Button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <TurnAlertCenter view={snapshot} onRefresh={refresh} />
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
          <article className="relative overflow-hidden rounded-3xl bg-[var(--navy)] p-6 text-white shadow-[0_20px_55px_rgb(12_27_48/14%)] sm:p-8">
            <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full border-[48px] border-white/[0.025]" />
            <div className="relative flex h-full min-h-[300px] flex-col justify-between gap-8">
              <div className="flex items-center justify-between gap-3">
                <Badge className="h-7 bg-white/10 px-3 text-[10px] uppercase tracking-[0.18em] text-white hover:bg-white/10">
                  Próximo da fila
                </Badge>
                <span className="flex items-center gap-2 text-xs text-white/55">
                  <span
                    className={`size-2 rounded-full ${
                      hasAvailableAgent
                        ? 'bg-[var(--brand-light)]'
                        : 'bg-white/30'
                    }`}
                  />
                  {hasAvailableAgent ? 'Disponível' : 'Todos indisponíveis'}
                </span>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--brand-light)]">
                  {hasAvailableAgent
                    ? 'Agora é a vez de'
                    : 'Ciclo preservado em'}
                </p>
                <h1 className="mt-2 break-words text-[clamp(2.7rem,7vw,5.8rem)] font-semibold leading-[.88] tracking-[-0.07em]">
                  {snapshot.nextAgent?.name}
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-white/55">
                  {hasAvailableAgent && snapshot.nextAgent
                    ? `É a vez de ${snapshot.nextAgent.name}. Ao registrar o atendimento, o ciclo avança sem alterar a ordem oficial.`
                    : 'Todos os suportes estão indisponíveis no momento. A ordem permanece intacta e o ciclo retoma automaticamente quando alguém ficar disponível.'}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    size="lg"
                    className="h-12 rounded-xl bg-[var(--brand)] px-5 font-semibold text-white shadow-[0_8px_24px_rgb(194_70_26/24%)] hover:bg-[var(--brand-strong)]"
                    disabled={!snapshot.nextAgent || !canOperateNext || pending}
                    onClick={() => {
                      if (!snapshot.nextAgent) return;
                      void run(
                        { type: 'claim', agentId: snapshot.nextAgent.id },
                        'Fila avançada com sucesso',
                      ).catch(() => undefined);
                    }}
                  >
                    Peguei atendimento
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 rounded-xl border-white/15 bg-white/5 px-5 text-white hover:bg-white/10 hover:text-white"
                    disabled={!snapshot.nextAgent || !canOperateNext || pending}
                    onClick={() => {
                      if (!snapshot.nextAgent) return;
                      void run(
                        { type: 'skip', agentId: snapshot.nextAgent.id },
                        'Vez pulada; fila atualizada',
                      ).catch(() => undefined);
                    }}
                  >
                    <RotateCcw data-icon="inline-start" />
                    Pular a vez
                  </Button>
                </div>

                {snapshot.undoCandidate ? (
                  <div className="flex flex-col gap-3 rounded-2xl border border-white/15 bg-white/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-medium text-white">
                        Retirada registrada para{' '}
                        {snapshot.undoCandidate.agentName}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-4 text-white/55">
                        Disponível por 5 minutos e somente enquanto a fila não
                        mudar.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                      disabled={pending}
                      onClick={() => setUndoOpen(true)}
                    >
                      <Undo2 />
                      Devolver para minha vez
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </article>

          <Card className="rounded-3xl border-0 bg-card py-0 shadow-[0_16px_44px_rgb(28_40_55/7%)] ring-1 ring-[var(--line)]">
            <CardContent className="px-0">
              <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-5 sm:px-6">
                <div>
                  <h2 className="font-semibold tracking-tight">Fila atual</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Indisponíveis são pulados sem perder a posição
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-[var(--line)] text-muted-foreground"
                >
                  {cycleAgents.length} pessoas
                </Badge>
              </div>
              <ol className="max-h-[404px] overflow-y-auto px-3 py-3">
                {cycleAgents.map((person, index) => {
                  const isNext = snapshot.nextAgent?.id === person.id;
                  const isOwnNext = isNext && viewer.agentId === person.id;
                  return (
                    <li
                      key={person.id}
                      className={`grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-2xl px-3 py-2.5 ${
                        isOwnNext
                          ? 'bg-[var(--brand)]/15 ring-2 ring-[var(--brand)]'
                          : isNext
                            ? 'bg-[var(--brand-soft)] ring-1 ring-[var(--brand-line)]'
                            : ''
                      }`}
                    >
                      <span
                        className={`grid size-8 place-items-center rounded-xl text-xs font-semibold ${
                          isNext
                            ? 'bg-[var(--navy)] text-white'
                            : 'bg-[var(--surface-muted)] text-muted-foreground'
                        }`}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium tracking-tight">
                          {person.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {person.todayCount} hoje ·{' '}
                          {person.online ? 'online' : 'offline'}
                        </span>
                      </span>
                      <Select
                        value={person.status}
                        onValueChange={(value) =>
                          void changeStatus(person, value as AgentStatus)
                        }
                        disabled={pending || !person.isActive}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-[116px] border-transparent bg-transparent px-2 text-[11px] hover:bg-[var(--surface-muted)]"
                          aria-label={`Status de ${person.name}`}
                        >
                          <span
                            className={`status-dot ${statusMeta[person.status].className}`}
                          />
                          <SelectValue>
                            {statusMeta[person.status].label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(statusMeta) as AgentStatus[]).map(
                            (status) => (
                              <SelectItem key={status} value={status}>
                                <span
                                  className={`status-dot ${statusMeta[status].className}`}
                                />
                                {statusMeta[status].label}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: 'Atendimentos hoje',
              value: snapshot.stats.todayTotal,
              icon: Headphones,
            },
            { label: 'Ordem oficial', value: cycleAgents.length, icon: Users },
            {
              label: 'Disponíveis agora',
              value: snapshot.stats.available,
              icon: Users,
            },
            {
              label: 'Indisponíveis agora',
              value: cycleAgents.length - snapshot.stats.available,
              icon: PauseCircle,
            },
          ].map(({ label, value, icon: Icon }) => (
            <Card
              key={label}
              className="rounded-2xl border-0 bg-card py-0 shadow-[0_10px_30px_rgb(28_40_55/5%)] ring-1 ring-[var(--line)]"
            >
              <CardContent className="flex items-center gap-4 p-4 sm:p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--slate)]">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-0.5 text-xl font-semibold tracking-[-0.04em]">
                    {value}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
          <OperationalCard
            title="Atividade recente"
            subtitle="Histórico do dia"
            icon={History}
          >
            {snapshot.events.length ? (
              <div className="max-h-[310px] divide-y divide-[var(--line)] overflow-y-auto">
                {snapshot.events.slice(0, 12).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 px-5 py-3.5"
                  >
                    <span className="w-10 shrink-0 text-[11px] text-muted-foreground">
                      {formatTime(event.occurredAt)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <strong className="font-medium">
                          {event.agentName || 'Sistema'}
                        </strong>{' '}
                        <span className="text-muted-foreground">
                          {actionLabels[event.action] || event.action}
                        </span>
                      </p>
                      {eventDescription(event) ? (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {eventDescription(event)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyRow text="O histórico de hoje começa com a primeira ação." />
            )}
          </OperationalCard>

          <OperationalCard
            title="Distribuição do dia"
            subtitle="Atendimentos por suporte"
            icon={Trophy}
          >
            <ol className="px-5 py-2">
              {ranking.map((agent, index) => {
                const maximum = Math.max(
                  1,
                  ...ranking.map((item) => item.todayCount),
                );
                return (
                  <li
                    key={agent.id}
                    className="grid grid-cols-[24px_1fr_auto] items-center gap-3 py-2.5"
                  >
                    <span className="text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {agent.name}
                      </p>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                        <div
                          className="h-full rounded-full bg-[var(--brand)]"
                          style={{
                            width: `${(agent.todayCount / maximum) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-semibold">
                      {agent.todayCount}
                    </span>
                  </li>
                );
              })}
            </ol>
          </OperationalCard>
        </section>

        <footer className="flex flex-col justify-between gap-2 py-6 text-[11px] text-muted-foreground sm:flex-row">
          <p>Atualização em tempo real · Horário de Brasília</p>
          <p>Última alteração às {formatTime(snapshot.updatedAt)}</p>
        </footer>
      </div>

      <Dialog open={undoOpen} onOpenChange={setUndoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver atendimento?</DialogTitle>
            <DialogDescription>
              Tem certeza que pegou este atendimento por engano? Ao confirmar,
              você voltará para o início da fila.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUndoOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending || !snapshot.undoCandidate}
              onClick={() => {
                if (!snapshot.undoCandidate) return;
                void run(
                  {
                    type: 'undo-claim',
                    claimEventId: snapshot.undoCandidate.claimEventId,
                  },
                  'Atendimento devolvido; fila restaurada',
                )
                  .then(() => setUndoOpen(false))
                  .catch(() => undefined);
              }}
            >
              <Undo2 />
              Devolver para minha vez
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function OperationalCard({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: typeof Headphones;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 rounded-2xl border-0 bg-card py-0 shadow-[0_10px_30px_rgb(28_40_55/5%)] ring-1 ring-[var(--line)]">
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
        <span className="grid size-8 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--slate)]">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="grid min-h-32 place-items-center px-5 py-8 text-center">
      <p className="max-w-xs text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}
