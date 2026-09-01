import { getSessionUserFromCookie } from '@/lib/auth-store';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginClient } from '@/app/login/login-client';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getSessionUserFromCookie((await headers()).get('cookie'));
  if (user) redirect('/');
  return <LoginClient />;
}
