import { AuthError, recordPresence, requireSession } from '@/lib/auth-store';
import { getSnapshot } from '@/lib/queue-store';

const encoder = new TextEncoder();

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function GET(request: Request) {
  try {
    const user = await requireSession(request);
    await recordPresence(user);
    const since = Number(new URL(request.url).searchParams.get('since') ?? -1);
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode('retry: 1000\n\n'));
        try {
          for (let attempt = 0; attempt < 25; attempt += 1) {
            if (request.signal.aborted) break;
            const snapshot = await getSnapshot();
            if (snapshot.version !== since) {
              controller.enqueue(
                encoder.encode(
                  `event: queue-change\ndata: ${JSON.stringify({ version: snapshot.version })}\n\n`,
                ),
              );
              break;
            }
            if (attempt > 0 && attempt % 10 === 0) {
              controller.enqueue(encoder.encode(': keepalive\n\n'));
            }
            await wait(1000);
          }
        } catch {
          controller.enqueue(encoder.encode('event: reconnect\ndata: {}\n\n'));
        } finally {
          controller.close();
        }
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
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: 'Tempo real indisponível.' }, { status: 500 });
  }
}
