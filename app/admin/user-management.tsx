'use client';

import { type ReactNode, type SyntheticEvent, useState } from 'react';
import { KeyRound, Pencil, Plus, UserCog, Wifi, WifiOff } from 'lucide-react';
import { AdminAuthorizationDialog } from '@/components/admin-authorization-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import type { ManagedUser, UserRole } from '@/lib/types';

type FormState = {
  id?: string;
  name: string;
  login: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
  isActive: boolean;
  participatesInQueue: boolean;
};

const emptyForm: FormState = {
  name: '',
  login: '',
  password: '',
  confirmPassword: '',
  role: 'admin',
  isActive: true,
  participatesInQueue: false,
};

export function UserManagement({
  initialUsers,
  queueVersion,
  onQueueRefresh,
}: {
  initialUsers: ManagedUser[];
  queueVersion: number;
  onQueueRefresh: () => Promise<unknown>;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [authorizationOpen, setAuthorizationOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');

  function newUser() {
    setForm(emptyForm);
    setFormError('');
    setFormOpen(true);
  }

  function editUser(user: ManagedUser) {
    setForm({
      id: user.id,
      name: user.name,
      login: user.login,
      password: '',
      confirmPassword: '',
      role: user.role,
      isActive: user.isActive,
      participatesInQueue: user.participatesInQueue,
    });
    setFormError('');
    setFormOpen(true);
  }

  function submitForm(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const existing = form.id ? users.find((user) => user.id === form.id) : null;
    if (!form.name.trim() || !form.login.trim()) {
      setFormError('Preencha nome e login.');
      return;
    }
    if ((!existing || !existing.passwordConfigured) && !form.password) {
      setFormError('Defina uma senha para liberar este acesso.');
      return;
    }
    if (form.password && form.password.length < 8) {
      setFormError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setFormError('As senhas não coincidem.');
      return;
    }
    setFormError('');
    setFormOpen(false);
    setAuthorizationOpen(true);
  }

  async function save(adminPassword: string) {
    setPending(true);
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id,
          version: queueVersion,
          adminPassword,
          name: form.name,
          login: form.login,
          password: form.password || undefined,
          role: form.role,
          isActive: form.isActive,
          participatesInQueue: form.participatesInQueue,
        }),
      });
      const payload = (await response.json()) as {
        users?: ManagedUser[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar o usuário.');
      if (payload.users) setUsers(payload.users);
      setAuthorizationOpen(false);
      await onQueueRefresh();
      toast.add({
        title: form.id ? 'Usuário atualizado' : 'Usuário criado',
        type: 'success',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Card className="mt-5 gap-0 rounded-2xl border-0 py-0 ring-1 ring-[var(--line)]">
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
              <UserCog className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Gerenciar usuários</h2>
              <p className="text-[10px] text-muted-foreground">
                Acessos e senhas; a sequência de suporte é fixa
              </p>
            </div>
          </div>
          <Button size="sm" onClick={newUser}>
            <Plus />
            Novo administrador
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Usuário</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Fila</TableHead>
                <TableHead>Presença</TableHead>
                <TableHead>Acesso</TableHead>
                <TableHead className="pr-5 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="pl-5">
                    <p className="font-medium">{user.name}</p>
                    <p className="text-[10px] text-muted-foreground">{user.login}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {user.role === 'admin' ? 'Administrador' : 'Suporte'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {user.participatesInQueue
                      ? user.queuePosition === null
                        ? 'Sequência oficial'
                        : `${user.queuePosition + 1}ª posição fixa`
                      : 'Não participa'}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      {user.online ? (
                        <Wifi className="size-3.5 text-emerald-500" />
                      ) : (
                        <WifiOff className="size-3.5" />
                      )}
                      {user.online ? 'Online' : 'Offline'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {!user.isActive ? (
                      <Badge variant="outline">Inativo</Badge>
                    ) : user.passwordConfigured ? (
                      <Badge variant="outline" className="text-emerald-700">Ativo</Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-700">
                        Definir senha
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => editUser(user)}>
                      {user.passwordConfigured ? <Pencil /> : <KeyRound />}
                      {user.passwordConfigured ? 'Editar' : 'Liberar acesso'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submitForm}>
            <DialogHeader>
              <DialogTitle>{form.id ? 'Editar usuário' : 'Novo administrador'}</DialogTitle>
              <DialogDescription>
                A ordem oficial dos suportes não pode ser editada. Aqui você libera
                acessos, redefine senhas ou cria outro administrador.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Nome">
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} disabled={form.participatesInQueue} />
              </Field>
              <Field label="Login">
                <Input value={form.login} onChange={(event) => setForm({ ...form, login: event.target.value })} maxLength={60} autoComplete="off" />
              </Field>
              <Field label={form.id ? 'Nova senha (opcional)' : 'Senha'}>
                <Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" />
              </Field>
              <Field label="Confirmar senha">
                <Input type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} autoComplete="new-password" />
              </Field>
              <Field label="Perfil">
                <Input value={form.participatesInQueue ? 'Suporte — sequência oficial' : 'Administrador'} disabled />
              </Field>
              <Field label="Posição na fila">
                <Input
                  value={form.participatesInQueue ? `${(users.find((user) => user.id === form.id)?.queuePosition ?? 0) + 1}ª posição fixa` : 'Não participa'}
                  disabled
                />
              </Field>
              <ToggleRow label="Usuário ativo" checked={form.isActive} onCheckedChange={(checked) => setForm({ ...form, isActive: checked })} />
              <div className="flex items-center rounded-xl border border-[var(--line)] px-3 py-2.5 text-xs font-medium text-muted-foreground">
                {form.participatesInQueue
                  ? 'Participação fixa na ordem oficial'
                  : 'Sem participação na fila'}
              </div>
            </div>
            {formError ? <p className="mt-3 text-xs text-destructive" role="alert">{formError}</p> : null}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
              <Button type="submit">Continuar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AdminAuthorizationDialog
        open={authorizationOpen}
        onOpenChange={setAuthorizationOpen}
        title={form.id ? 'Autorizar edição do usuário' : 'Autorizar novo administrador'}
        pending={pending}
        onConfirm={save}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5 text-xs font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-[var(--line)] px-3 py-2.5 text-xs font-medium">
      {label}
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
