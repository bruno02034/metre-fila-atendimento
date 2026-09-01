import { AdminClient } from '@/app/admin/admin-client';
import { getSnapshot } from '@/lib/queue-store';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const snapshot = await getSnapshot();
  return <AdminClient initialSnapshot={snapshot} />;
}
