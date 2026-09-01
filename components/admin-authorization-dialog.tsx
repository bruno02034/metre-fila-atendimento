'use client';

import { FormEvent, useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function AdminAuthorizationDialog({
  open,
  onOpenChange,
  title,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  pending: boolean;
  onConfirm: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setPassword('');
    setError('');
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || pending) return;
    setError('');
    try {
      await onConfirm(password);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'A autorização não pôde ser validada.',
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <span className="mb-1 grid size-9 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
              <LockKeyhole className="size-4" aria-hidden="true" />
            </span>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Esta ação requer autorização. Digite a senha de administrador para
              continuar.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <label htmlFor="admin-password" className="text-xs font-medium">
              Senha
            </label>
            <Input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'admin-password-error' : undefined}
              placeholder="Digite a senha"
              className="h-10"
            />
            {error ? (
              <p id="admin-password-error" className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !password}>
              <LockKeyhole />
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
