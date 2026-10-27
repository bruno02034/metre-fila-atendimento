import { AuthError, requireSession } from '@/lib/auth-store';
import { getQueueVersion, QueueError } from '@/lib/queue-store';

const encoder = new TextEncoder();
// Compatibilidade temporária com abas que ainda estejam usando uma versão antiga.
// Clientes novos usam a consulta condicional leve de /api/queue.
const CHECK_INTERVAL_MS = 5000;
const STREAM_LIFETIME_MS = 20000;
const HEARTBEAT_INTERVAL_MS = 10000;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function GET(request: Request) {
  try {
    await requireSession(request);
    const requestedVersion = Number(
      new URL(request.url).searchParams.get('version'),
    );
    const observedVersion =
      Number.isInteger(requestedVersion) && requestedVersion >= 0
        ? requestedVersion
        : await getQueueVersion();
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        const startedAt = Date.now();
        let lastHeartbeatAt = startedAt;
        controller.enqueue(encoder.encode('retry: 1000\n\n'));
        try {
          while (!cancelled && Date.now() - startedAt < STREAM_LIFETIME_MS) {
            await wait(CHECK_INTERVAL_MS);
            if (cancelled) return;
            const currentVersion = await getQueueVersion();
            if (currentVersion !== observedVersion) {
              controller.enqueue(
                encoder.encode(
                  `event: queue-change\ndata: ${JSON.stringify({ version: currentVersion })}\n\n`,
                ),
              );
              controller.close();
              return;
            }
            if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
              controller.enqueue(encoder.encode(': heartbeat\n\n'));
              lastHeartbeatAt = Date.now();
            }
          }
          if (!cancelled) {
            controller.enqueue(
              encoder.encode('event: reconnect\ndata: {}\n\n'),
            );
            controller.close();
          }
        } catch {
          if (!cancelled) controller.error(new Error('stream_failed'));
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    if (error instanceof AuthError || error instanceof QueueError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: 'Tempo real indisponível.' },
      { status: 500 },
    );
  }
}
