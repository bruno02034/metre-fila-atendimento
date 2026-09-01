import { AuthError, requireSession } from '@/lib/auth-store';

export async function GET(request: Request) {
  try {
    const user = await requireSession(request);
    return Response.json({ user }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: 'Não foi possível validar a sessão.' }, { status: 500 });
  }
}
