'use client';

import { type SyntheticEvent, useState } from 'react';
import { ArrowRight, LockKeyhole, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function LoginClient() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!login || !password || pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível entrar.');
      window.location.assign('/');
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Não foi possível entrar.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-[var(--navy)] px-4 py-10 text-foreground sm:place-items-center">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-24 -top-28 size-[420px] rounded-full border-[72px] border-white/[0.025]" />
        <div className="absolute -bottom-40 -left-32 size-[520px] rounded-full border-[90px] border-[var(--brand)]/[0.06]" />
      </div>

      <div className="relative mx-auto w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <img src="/metre-logo.png" alt="" className="size-14 object-contain" />
          <div>
            <p className="text-xl font-semibold tracking-tight">Metre</p>
            <p className="text-xs text-white/55">Fila de atendimento</p>
          </div>
        </div>

        <Card className="border-0 bg-card py-0 shadow-[0_28px_80px_rgb(0_0_0/28%)] ring-1 ring-white/10">
          <CardContent className="p-6 sm:p-8">
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
              <LockKeyhole className="size-4" />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">Entrar no painel</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Use seu acesso individual para acompanhar sua posição e receber alertas.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="login" className="text-xs font-medium">
                  Login
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="login"
                    value={login}
                    onChange={(event) => setLogin(event.target.value)}
                    autoComplete="username"
                    className="h-11 pl-10"
                    placeholder="seu.login"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-xs font-medium">
                  Senha
                </label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    className="h-11 pl-10"
                    placeholder="Digite sua senha"
                    aria-invalid={Boolean(error)}
                  />
                </div>
              </div>
              {error ? (
                <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" size="lg" className="h-11 w-full" disabled={pending || !login || !password}>
                {pending ? 'Entrando…' : 'Entrar'}
                <ArrowRight />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
