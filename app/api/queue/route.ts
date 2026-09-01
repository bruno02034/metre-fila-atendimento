import {
  AuthError,
  assertSameOrigin,
  authorizeQueueCommand,
  queueViewForUser,
  recordPresence,
  requireSession,
} from '@/lib/auth-store';
import { executeCommand, getSnapshot, QueueError } from '@/lib/queue-store';
import type { QueueCommand } from '@/lib/types';

export async function GET(request: Request) {
  try {
    const user = await requireSession(request);
    await recordPresence(user);
    const snapshot = await getSnapshot();
    const view = await queueViewForUser(user, snapshot);
    return Response.json(view, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof AuthError || error instanceof QueueError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return Response.json(
      { error: 'Não foi possível carregar a fila.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSession(request);
    await recordPresence(user);
    const command = (await request.json()) as QueueCommand;
    const before = await getSnapshot();
    authorizeQueueCommand(user, command, before);
    const snapshot = await executeCommand(command);
    const view = await queueViewForUser(user, snapshot);
    return Response.json(view, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof QueueError || error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return Response.json(
      { error: 'A operação não pôde ser concluída.' },
      { status: 500 },
    );
  }
}
