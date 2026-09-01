import { DashboardClient } from '@/app/dashboard-client';
import {
  getSessionUserFromCookie,
  queueViewForUser,
  recordPresence,
} from '@/lib/auth-store';
import { getSnapshot } from '@/lib/queue-store';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getSessionUserFromCookie((await headers()).get('cookie'));
  if (!user) redirect('/login');
  await recordPresence(user);
  const snapshot = await getSnapshot();
  const view = await queueViewForUser(user, snapshot);
  return <DashboardClient initialSnapshot={view} />;
}
