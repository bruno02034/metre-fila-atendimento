import { AuthError, requirePersistentSession } from '@/lib/auth-store';

export async function GET(request: Request) {
  try {
    const { user, refreshedCookie } = await requirePersistentSession(request);
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (refreshedCookie) headers['Set-Cookie'] = refreshedCookie;
    return Response.json({ user }, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: 'Não foi possível validar a sessão.' }, { status: 500 });
  }
}
