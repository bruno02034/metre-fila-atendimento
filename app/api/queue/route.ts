import { executeCommand, getSnapshot, QueueError } from '@/lib/queue-store';
import type { QueueCommand } from '@/lib/types';

export async function GET() {
  try {
    const snapshot = await getSnapshot();
    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: 'Não foi possível carregar a fila.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const command = (await request.json()) as QueueCommand;
    const snapshot = await executeCommand(command);
    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof QueueError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return Response.json(
      { error: 'A operação não pôde ser concluída.' },
      { status: 500 },
    );
  }
}
