'use client';

import { FormEvent, useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Headphones,
  History,
  LayoutDashboard,
  PauseCircle,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trophy,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
  OpenTicket,
  QueueCommandInput,
  QueueEvent,
  QueueSnapshot,
} from '@/lib/types';

const statusMeta: Record<
  AgentStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  available: {
    label: 'Disponível',
    className: 'status-available',
    icon: UserRoundCheck,
  },
  busy: { label: 'Ocupado', className: 'status-busy', icon: Headphones },
  paused: { label: 'Pausado', className: 'status-paused', icon: PauseCircle },
  away: { label: 'Ausente', className: 'status-away', icon: Users },
};

const actionLabels: Record<string, string> = {
  claim: 'Pegou atendimento',
  skip: 'Pulou a vez',
  status_change: 'Alterou o status',
  close: 'Encerrou atendimento',
  transfer: 'Transferiu atendimento',
  agent_added: 'Adicionou suporte',
  agent_activated: 'Ativou suporte',
  agent_deactivated: 'Desativou suporte',
  queue_reordered: 'Reordenou a fila',
  queue_reset: 'Resetou a fila',
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function elapsed(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  return formatDuration(seconds);
}

function eventDescription(event: QueueEvent) {
  if (event.action === 'transfer' && event.secondaryAgentName) {
    return `para ${event.secondaryAgentName}`;
  }
  if (event.externalId) return event.externalId;
  if (event.action === 'status_change' && event.details?.to) {
    return statusMeta[event.details.to as AgentStatus]?.label ?? '';
  }
  return '';
}

export function DashboardClient({
  initialSnapshot,
}: {
  initialSnapshot: QueueSnapshot;
}) {
  const { snapshot, pending, refresh, mutate } = useQueue(initialSnapshot);
  const [claimOpen, setClaimOpen] = useState(false);
  const [ticketCode, setTicketCode] = useState('');
  const [client, setClient] = useState('');
  const [transferTicket, setTransferTicket] = useState<OpenTicket | null>(null);
  const [targetAgentId, setTargetAgentId] = useState('');

  const activeAgents = snapshot.agents.filter((agent) => agent.isActive);
  const ranking = useMemo(
    () =>
      [...activeAgents].sort(
        (a, b) => b.todayCount - a.todayCount || a.queuePosition - b.queuePosition,
      ),
    [activeAgents],
  );

  async function run(input: QueueCommandInput, success: string) {
    try {
      await mutate(input);
      toast.add({ title: success, type: 'success' });
    } catch (error) {
      toast.add({
        title: 'Atenção',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        type: 'error',
      });
      throw error;
    }
  }

  async function handleClaim(event: FormEvent) {
    event.preventDefault();
    if (!snapshot.nextAgent) return;
    try {
      await run(
        {
          type: 'claim',
          agentId: snapshot.nextAgent.id,
          externalId: ticketCode,
          client,
        },
        'Atendimento registrado',
      );
      setClaimOpen(false);
      setTicketCode('');
      setClient('');
    } catch {
      // Feedback is shown by the shared toast.
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

  async function finishTicket(ticket: OpenTicket) {
    try {
      await run({ type: 'close', ticketId: ticket.id }, 'Atendimento encerrado');
    } catch {
      // Feedback is shown by the shared toast.
    }
  }

  async function handleTransfer(event: FormEvent) {
    event.preventDefault();
    if (!transferTicket || !targetAgentId) return;
    try {
      await run(
        {
          type: 'transfer',
          ticketId: transferTicket.id,
          targetAgentId,
        },
        'Atendimento transferido',
      );
      setTransferTicket(null);
      setTargetAgentId('');
    } catch {
      // Feedback is shown by the shared toast.
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Toaster />
      <header className="border-b border-white/10 bg-[var(--navy)] text-white">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-3" aria-label="Ir para o painel">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--mint)] text-[var(--navy)] shadow-[0_6px_20px_rgb(46_230_166/18%)]">
              <Headphones className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold leading-none tracking-tight">Pulso</p>
              <p className="mt-1 text-[11px] text-white/55">Fila de atendimento</p>
            </div>
          </a>
          <nav className="flex items-center gap-1" aria-label="Navegação principal">
            <a
              href="/"
              className="hidden items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium sm:flex"
            >
              <LayoutDashboard className="size-3.5" />
              Operação
            </a>
            <a
              href="/admin"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Settings2 className="size-3.5" />
              Administração
            </a>
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
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
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
                      snapshot.nextAgent ? 'bg-[var(--mint)]' : 'bg-white/30'
                    }`}
                  />
                  {snapshot.nextAgent ? 'Disponível' : 'Sem disponibilidade'}
                </span>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--mint)]">
                  {snapshot.nextAgent ? 'Agora é a vez de' : 'Aguardando retorno'}
                </p>
                <h1 className="mt-2 break-words text-[clamp(2.7rem,7vw,5.8rem)] font-semibold leading-[.88] tracking-[-0.07em]">
                  {snapshot.nextAgent?.name ?? 'NINGUÉM'}
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-white/55">
                  {snapshot.nextAgent
                    ? `É a vez de ${snapshot.nextAgent.name} pegar o próximo atendimento. Ao confirmar, essa pessoa vai para o fim da fila.`
                    : 'Marque ao menos uma pessoa como disponível para retomar a distribuição.'}
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  size="lg"
                  className="h-12 rounded-xl bg-[var(--mint)] px-5 font-semibold text-[var(--navy)] shadow-[0_8px_24px_rgb(46_230_166/16%)] hover:bg-[var(--mint-strong)]"
                  disabled={!snapshot.nextAgent || pending}
                  onClick={() => setClaimOpen(true)}
                >
                  Peguei atendimento
                  <ArrowRight data-icon="inline-end" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-xl border-white/15 bg-white/5 px-5 text-white hover:bg-white/10 hover:text-white"
                  disabled={!snapshot.nextAgent || pending}
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
                <Badge variant="outline" className="border-[var(--line)] text-muted-foreground">
                  {activeAgents.length} pessoas
                </Badge>
              </div>
              <ol className="max-h-[404px] overflow-y-auto px-3 py-3">
                {activeAgents.map((person, index) => {
                  const isNext = snapshot.nextAgent?.id === person.id;
                  return (
                    <li
                      key={person.id}
                      className={`grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-2xl px-3 py-2.5 ${
                        isNext
                          ? 'bg-[var(--mint-soft)] ring-1 ring-[var(--mint-line)]'
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
                          {person.todayCount} hoje
                        </span>
                      </span>
                      <Select
                        value={person.status}
                        onValueChange={(value) =>
                          void changeStatus(person, value as AgentStatus)
                        }
                        disabled={pending}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-[116px] border-transparent bg-transparent px-2 text-[11px] hover:bg-[var(--surface-muted)]"
                          aria-label={`Status de ${person.name}`}
                        >
                          <span
                            className={`status-dot ${statusMeta[person.status].className}`}
                          />
                          <SelectValue>{statusMeta[person.status].label}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(statusMeta) as AgentStatus[]).map((status) => (
                            <SelectItem key={status} value={status}>
                              <span className={`status-dot ${statusMeta[status].className}`} />
                              {statusMeta[status].label}
                            </SelectItem>
                          ))}
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
            { label: 'Atendimentos hoje', value: snapshot.stats.todayTotal, icon: Headphones },
            { label: 'Disponíveis agora', value: snapshot.stats.available, icon: Users },
            { label: 'Em atendimento', value: snapshot.stats.busy, icon: CheckCircle2 },
            {
              label: 'Tempo médio',
              value: formatDuration(snapshot.stats.averageSeconds),
              icon: Clock3,
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
                  <p className="truncate text-[11px] text-muted-foreground">{label}</p>
                  <p className="mt-0.5 text-xl font-semibold tracking-[-0.04em]">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_.78fr]">
          <OperationalCard
            title="Em atendimento"
            subtitle={`${snapshot.openTickets.length} atendimento${snapshot.openTickets.length === 1 ? '' : 's'} aberto${snapshot.openTickets.length === 1 ? '' : 's'}`}
            icon={Headphones}
          >
            {snapshot.openTickets.length ? (
              <div className="divide-y divide-[var(--line)]">
                {snapshot.openTickets.map((ticket) => (
                  <div key={ticket.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-500">
                      <Headphones className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{ticket.ownerName}</p>
                        <span className="text-[10px] text-muted-foreground">
                          {elapsed(ticket.startedAt)}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {ticket.externalId || 'Sem ticket informado'}
                        {ticket.client ? ` · ${ticket.client}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        setTransferTicket(ticket);
                        setTargetAgentId('');
                      }}
                    >
                      Transferir
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => void finishTicket(ticket)}
                    >
                      Encerrar
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyRow text="Nenhum atendimento aberto agora." />
            )}
          </OperationalCard>

          <OperationalCard
            title="Atividade recente"
            subtitle="Histórico do dia"
            icon={History}
          >
            {snapshot.events.length ? (
              <div className="max-h-[310px] divide-y divide-[var(--line)] overflow-y-auto">
                {snapshot.events.slice(0, 12).map((event) => (
                  <div key={event.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="w-10 shrink-0 text-[11px] text-muted-foreground">
                      {formatTime(event.occurredAt)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <strong className="font-medium">{event.agentName || 'Sistema'}</strong>{' '}
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
                const maximum = Math.max(1, ...ranking.map((item) => item.todayCount));
                return (
                  <li key={agent.id} className="grid grid-cols-[24px_1fr_auto] items-center gap-3 py-2.5">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{agent.name}</p>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                        <div
                          className="h-full rounded-full bg-[var(--mint)]"
                          style={{ width: `${(agent.todayCount / maximum) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-semibold">{agent.todayCount}</span>
                  </li>
                );
              })}
            </ol>
          </OperationalCard>
        </section>

        <footer className="flex flex-col justify-between gap-2 py-6 text-[11px] text-muted-foreground sm:flex-row">
          <p>Atualização automática a cada 5 segundos · Horário de Brasília</p>
          <p>Última alteração às {formatTime(snapshot.updatedAt)}</p>
        </footer>
      </div>

      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleClaim}>
            <DialogHeader>
              <DialogTitle>Registrar atendimento</DialogTitle>
              <DialogDescription>
                {snapshot.nextAgent?.name} será marcado como ocupado e irá para o
                fim da fila. Os dados do ticket são opcionais.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-5">
              <label className="grid gap-1.5 text-xs font-medium">
                Ticket
                <Input
                  value={ticketCode}
                  onChange={(event) => setTicketCode(event.target.value)}
                  placeholder="Ex.: TF-1042"
                  autoFocus
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                Cliente
                <Input
                  value={client}
                  onChange={(event) => setClient(event.target.value)}
                  placeholder="Nome do cliente (opcional)"
                />
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClaimOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !snapshot.nextAgent}>
                {pending ? 'Registrando…' : 'Confirmar atendimento'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(transferTicket)}
        onOpenChange={(open) => {
          if (!open) setTransferTicket(null);
        }}
      >
        <DialogContent>
          <form onSubmit={handleTransfer}>
            <DialogHeader>
              <DialogTitle>Transferir atendimento</DialogTitle>
              <DialogDescription>
                A transferência não conta como um novo atendimento e não altera a
                ordem da fila.
              </DialogDescription>
            </DialogHeader>
            <div className="py-5">
              <label className="grid gap-1.5 text-xs font-medium">
                Transferir para
                <Select
                  value={targetAgentId}
                  onValueChange={(value) => setTargetAgentId(value ?? '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Escolha um suporte" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeAgents
                      .filter((agent) => agent.id !== transferTicket?.ownerAgentId)
                      .map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name} · {statusMeta[agent.status].label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTransferTicket(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!targetAgentId || pending}>
                Transferir
                <ArrowUpRight />
              </Button>
            </DialogFooter>
          </form>
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
