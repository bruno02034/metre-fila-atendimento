import {
  assertSameOrigin,
  AuthError,
  recordPresence,
  requirePersistentSession,
} from '@/lib/auth-store';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { user, refreshedCookie } = await requirePersistentSession(request);
    const lastSeenAt = await recordPresence(user);
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (refreshedCookie) headers['Set-Cookie'] = refreshedCookie;
    return Response.json({ lastSeenAt }, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: 'Não foi possível registrar presença.' }, { status: 500 });
  }
}
