import { AuthError, recordPresence, requireSession } from '@/lib/auth-store';

const encoder = new TextEncoder();

export async function GET(request: Request) {
  try {
    const user = await requireSession(request);
    await recordPresence(user);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: queue-change\ndata: {}\n\n'),
        );
        controller.close();
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
