'use client';

import { FormEvent, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  History,
  Plus,
  Power,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  UserMinus,
  UserRoundPlus,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Toaster, toast } from '@/components/ui/toast';
import { useQueue } from '@/hooks/use-queue';
import type {
  AgentStatus,
  QueueCommandInput,
  QueueSnapshot,
} from '@/lib/types';

const statusLabels: Record<AgentStatus, string> = {
  available: 'Disponível',
  busy: 'Ocupado',
  paused: 'Pausado',
  away: 'Ausente',
};

const actionLabels: Record<string, string> = {
  claim: 'Pegou atendimento',
  undo_claim: 'Devolveu o atendimento — voltou para sua vez na fila',
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function AdminClient({
  initialSnapshot,
}: {
  initialSnapshot: QueueSnapshot;
}) {
  const { snapshot, pending, mutate } = useQueue(initialSnapshot);
  const [newAgentName, setNewAgentName] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const activeAgents = snapshot.agents.filter((agent) => agent.isActive);
  const inactiveAgents = snapshot.agents.filter((agent) => !agent.isActive);

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

  async function addAgent(event: FormEvent) {
    event.preventDefault();
    if (!newAgentName.trim()) return;
    try {
      await run({ type: 'add-agent', name: newAgentName }, 'Suporte adicionado');
      setNewAgentName('');
    } catch {
      // Feedback is shown by the shared toast.
    }
  }

  async function moveAgent(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= activeAgents.length) return;
    const ids = activeAgents.map((agent) => agent.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await run({ type: 'reorder', agentIds: ids }, 'Ordem da fila atualizada');
    } catch {
      // Feedback is shown by the shared toast.
    }
  }

  async function toggleAgent(agentId: string, isActive: boolean) {
    try {
      await run(
        { type: 'toggle-agent', agentId, isActive },
        isActive ? 'Suporte reativado' : 'Suporte desativado',
      );
    } catch {
      // Feedback is shown by the shared toast.
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Toaster />
      <header className="border-b border-white/10 bg-[var(--navy)] text-white">
        <div className="mx-auto flex h-16 max-w-[1380px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-3">
            <img
              src="/metre-logo.png"
              alt=""
              className="size-11 shrink-0 object-contain drop-shadow-[0_6px_16px_rgb(194_70_26/25%)]"
            />
            <div>
              <p className="font-semibold leading-none tracking-tight">Metre</p>
              <p className="mt-1 text-[11px] text-white/55">Administração</p>
            </div>
          </a>
          <a
            href="/"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="size-3.5" />
            Voltar à operação
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--brand)]">
              <ShieldCheck className="size-4" />
              Controle operacional
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Administração da fila</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Organize a equipe sem apagar o histórico. Desativar um suporte o remove
              da rotação, mas preserva seus registros.
            </p>
          </div>
          <Button variant="outline" onClick={() => setResetOpen(true)} disabled={pending}>
            <RefreshCcw />
            Resetar ordem inicial
          </Button>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Equipe ativa', value: activeAgents.length, icon: Users },
            { label: 'Disponíveis', value: snapshot.stats.available, icon: CheckCircle2 },
            { label: 'Atendimentos hoje', value: snapshot.stats.todayTotal, icon: BarChart3 },
            { label: 'Registros hoje', value: snapshot.events.length, icon: History },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label} className="gap-0 rounded-2xl border-0 py-0 ring-1 ring-[var(--line)]">
              <CardContent className="flex items-center gap-4 p-5">
                <span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--slate)]">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="text-xl font-semibold tracking-[-0.04em]">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)]">
          <Card className="gap-0 rounded-2xl border-0 py-0 ring-1 ring-[var(--line)]">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--slate)]">
                  <Settings2 className="size-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Ordem e equipe ativa</h2>
                  <p className="text-[10px] text-muted-foreground">
                    Use as setas para alterar a sequência imediatamente
                  </p>
                </div>
              </div>
              <Badge variant="outline">{activeAgents.length} ativos</Badge>
            </div>
            <ol className="divide-y divide-[var(--line)] px-5">
              {activeAgents.map((agent, index) => (
                <li key={agent.id} className="grid grid-cols-[36px_1fr_auto] items-center gap-3 py-3.5">
                  <span className="grid size-8 place-items-center rounded-xl bg-[var(--navy)] text-xs font-semibold text-white">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{agent.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {statusLabels[agent.status]} · {agent.todayCount} hoje
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Mover ${agent.name} para cima`}
                      disabled={pending || index === 0}
                      onClick={() => void moveAgent(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Mover ${agent.name} para baixo`}
                      disabled={pending || index === activeAgents.length - 1}
                      onClick={() => void moveAgent(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Desativar ${agent.name}`}
                      disabled={pending}
                      onClick={() => void toggleAgent(agent.id, false)}
                    >
                      <UserMinus />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <div className="grid content-start gap-5">
            <Card className="gap-0 rounded-2xl border-0 py-0 ring-1 ring-[var(--line)]">
              <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
                <span className="grid size-9 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <UserRoundPlus className="size-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Adicionar suporte</h2>
                  <p className="text-[10px] text-muted-foreground">Entra no fim da fila</p>
                </div>
              </div>
              <form onSubmit={addAgent} className="flex gap-2 p-5">
                <Input
                  value={newAgentName}
                  onChange={(event) => setNewAgentName(event.target.value)}
                  placeholder="Nome do suporte"
                  maxLength={60}
                />
                <Button type="submit" disabled={pending || !newAgentName.trim()}>
                  <Plus />
                  Adicionar
                </Button>
              </form>
            </Card>

            <Card className="gap-0 rounded-2xl border-0 py-0 ring-1 ring-[var(--line)]">
              <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--slate)]">
                    <Power className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold">Fora da rotação</h2>
                    <p className="text-[10px] text-muted-foreground">Histórico preservado</p>
                  </div>
                </div>
                <Badge variant="outline">{inactiveAgents.length}</Badge>
              </div>
              {inactiveAgents.length ? (
                <div className="divide-y divide-[var(--line)] px-5">
                  {inactiveAgents.map((agent) => (
                    <div key={agent.id} className="flex items-center justify-between gap-3 py-3.5">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">{agent.name}</p>
                        <p className="text-[10px] text-muted-foreground">Desativado</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => void toggleAgent(agent.id, true)}
                      >
                        Reativar
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="p-5 text-xs text-muted-foreground">Ninguém desativado.</p>
              )}
            </Card>
          </div>
        </section>

        <Card className="mt-5 gap-0 rounded-2xl border-0 py-0 ring-1 ring-[var(--line)]">
          <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--slate)]">
              <History className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Histórico de hoje</h2>
              <p className="text-[10px] text-muted-foreground">
                Registro auditável das mudanças da fila
              </p>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Horário</TableHead>
                <TableHead>Suporte</TableHead>
                <TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.events.length ? (
                snapshot.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="pl-5 text-muted-foreground">
                      {formatDateTime(event.occurredAt)}
                    </TableCell>
                    <TableCell className="font-medium">{event.agentName || 'Sistema'}</TableCell>
                    <TableCell>{actionLabels[event.action] || event.action}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="h-28 text-center text-muted-foreground">
                    Nenhuma atividade registrada hoje.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetar a ordem da fila?</DialogTitle>
            <DialogDescription>
              A equipe ativa volta à ordem inicial de cadastro. Status, contagens e
              histórico não serão apagados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                void run({ type: 'reset' }, 'Fila resetada').then(() => setResetOpen(false));
              }}
            >
              <RefreshCcw />
              Confirmar reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
