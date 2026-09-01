'use client';

import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  History,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { UserManagement } from '@/app/admin/user-management';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Toaster } from '@/components/ui/toast';
import { useQueue } from '@/hooks/use-queue';
import type { AgentStatus, ManagedUser, QueueView } from '@/lib/types';

const statusLabels: Record<AgentStatus, string> = {
  available: 'Disponível',
  busy: 'Ocupado',
  paused: 'Pausado',
  away: 'Ausente',
};

const actionLabels: Record<string, string> = {
  claim: 'Pegou atendimento',
  undo_claim: 'Devolveu o atendimento — voltou para sua vez',
  skip: 'Pulou a vez',
  automatic_skip: 'Foi pulado automaticamente',
  status_change: 'Alterou o status',
  user_created: 'Criou um acesso',
  user_updated: 'Atualizou um acesso',
  user_updated_password_reset: 'Atualizou o acesso e redefiniu a senha',
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
  initialUsers,
}: {
  initialSnapshot: QueueView;
  initialUsers: ManagedUser[];
}) {
  const { snapshot, refresh } = useQueue(initialSnapshot);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Toaster />
      <header className="border-b border-white/10 bg-[var(--navy)] text-white">
        <div className="mx-auto flex h-16 max-w-[1380px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-3">
            <img src="/metre-logo.png" alt="" className="size-11 shrink-0 object-contain" />
            <div>
              <p className="font-semibold leading-none tracking-tight">Metre</p>
              <p className="mt-1 text-[11px] text-white/55">Administração</p>
            </div>
          </a>
          <div className="flex items-center gap-1">
            <span className="hidden px-3 text-xs text-white/65 md:inline">
              Olá, <strong className="font-medium text-white">{snapshot.viewer.name}</strong>
            </span>
            <a
              href="/"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="size-3.5" />
              Voltar à operação
            </a>
            <Button
              variant="ghost"
              size="icon"
              className="text-white/65 hover:bg-white/10 hover:text-white"
              aria-label="Sair"
              onClick={() => void logout()}
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--brand)]">
            <ShieldCheck className="size-4" />
            Controle operacional
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em]">
            Administração da fila
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            A sequência de atendimento é oficial e imutável. A administração pode
            gerenciar acessos e disponibilidade, mas não pode reordenar pessoas.
          </p>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Equipe oficial', value: snapshot.agents.length, icon: Users },
            { label: 'Disponíveis online', value: snapshot.stats.available, icon: CheckCircle2 },
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

        <Card className="mt-5 gap-0 rounded-2xl border-0 py-0 ring-1 ring-[var(--line)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--slate)]">
                <LockKeyhole className="size-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Ordem oficial fixa</h2>
                <p className="text-[10px] text-muted-foreground">
                  O ciclo avança sem mover nenhuma pessoa de posição
                </p>
              </div>
            </div>
            <Badge variant="outline">Imutável</Badge>
          </div>
          <ol className="grid gap-x-8 px-5 py-2 md:grid-cols-2">
            {snapshot.agents.map((agent) => (
              <li key={agent.id} className="grid grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-[var(--line)] py-3.5">
                <span className="grid size-8 place-items-center rounded-xl bg-[var(--navy)] text-xs font-semibold text-white">
                  {String(agent.queuePosition + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{agent.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {statusLabels[agent.status]} · {agent.online ? 'online' : 'offline'} · {agent.todayCount} hoje
                  </p>
                </div>
                {snapshot.nextAgent?.id === agent.id ? (
                  <Badge className="bg-[var(--brand)] text-white">Próximo</Badge>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>

        <UserManagement
          initialUsers={initialUsers}
          queueVersion={snapshot.version}
          onQueueRefresh={refresh}
        />

        <Card className="mt-5 gap-0 rounded-2xl border-0 py-0 ring-1 ring-[var(--line)]">
          <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-muted)] text-[var(--slate)]">
              <History className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Histórico de hoje</h2>
              <p className="text-[10px] text-muted-foreground">
                Atendimentos, pulos automáticos e ações administrativas
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
                    <TableCell>
                      {actionLabels[event.action] || event.action}
                      {event.secondaryAgentName && event.action === 'automatic_skip'
                        ? ` — direcionado para ${event.secondaryAgentName}`
                        : ''}
                    </TableCell>
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
    </main>
  );
}
