import {
  AuthError,
  assertSameOrigin,
  authorizeQueueCommand,
  queueViewForUser,
  requireSession,
} from '@/lib/auth-store';
import {
  executeCommand,
  getQueueVersion,
  getSnapshot,
  QueueError,
} from '@/lib/queue-store';
import type { QueueCommand } from '@/lib/types';

export async function GET(request: Request) {
  try {
    const user = await requireSession(request);
    const versionParameter = new URL(request.url).searchParams.get('version');
    const requestedVersion =
      versionParameter === null ? null : Number(versionParameter);
    if (
      typeof requestedVersion === 'number' &&
      Number.isInteger(requestedVersion) &&
      requestedVersion >= 0
    ) {
      const currentVersion = await getQueueVersion();
      if (currentVersion === requestedVersion) {
        return new Response(null, {
          status: 204,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    }
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
    const command = (await request.json()) as QueueCommand;
    const before = await getSnapshot();
    authorizeQueueCommand(user, command, before);
    const snapshot = await executeCommand(command, user, before);
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
