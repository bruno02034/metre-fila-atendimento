import { DashboardClient } from '@/app/dashboard-client';
import { getSnapshot } from '@/lib/queue-store';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const snapshot = await getSnapshot();
  return <DashboardClient initialSnapshot={snapshot} />;
}
