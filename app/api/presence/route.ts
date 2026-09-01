import {
  assertSameOrigin,
  AuthError,
  recordPresence,
  requireSession,
} from '@/lib/auth-store';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSession(request);
    const lastSeenAt = await recordPresence(user);
    return Response.json({ lastSeenAt });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: 'Não foi possível registrar presença.' }, { status: 500 });
  }
}
