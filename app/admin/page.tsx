import { AdminClient } from '@/app/admin/admin-client';
import {
  getSessionUserFromCookie,
  listManagedUsers,
  queueViewForUser,
  recordPresence,
} from '@/lib/auth-store';
import { getSnapshot } from '@/lib/queue-store';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await getSessionUserFromCookie((await headers()).get('cookie'));
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  await recordPresence(user);
  const snapshot = await getSnapshot();
  const [view, users] = await Promise.all([
    queueViewForUser(user, snapshot),
    listManagedUsers(),
  ]);
  return <AdminClient initialSnapshot={view} initialUsers={users} />;
}
