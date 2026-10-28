import type { SessionUser } from '@/lib/types';

export function canSkipAgent(user: SessionUser, agentId: string) {
  return Boolean(
    user.role === 'admin' ||
      user.canSkipOthers ||
      (user.agentId && user.agentId === agentId),
  );
}
