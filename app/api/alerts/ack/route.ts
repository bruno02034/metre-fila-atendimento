import {
  acknowledgeTurn,
  assertSameOrigin,
  AuthError,
  requireSession,
} from '@/lib/auth-store';
import { getSnapshot } from '@/lib/queue-store';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSession(request);
    const body = (await request.json()) as { sequence?: number };
    const snapshot = await getSnapshot();
    if (
      !user.agentId ||
      snapshot.nextAgent?.id !== user.agentId ||
      snapshot.turn.sequence !== Number(body.sequence)
    ) {
      throw new AuthError('Esse alerta não pertence mais à sua vez.', 409);
    }
    const acknowledgedAt = await acknowledgeTurn(user, Number(body.sequence));
    return Response.json({ acknowledgedAt });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: 'Não foi possível reconhecer o alerta.' }, { status: 500 });
  }
}
