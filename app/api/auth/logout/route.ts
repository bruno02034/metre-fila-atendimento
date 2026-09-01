import {
  assertSameOrigin,
  AuthError,
  clearSessionCookie,
  logoutUser,
} from '@/lib/auth-store';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await logoutUser(request);
    return Response.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Set-Cookie': clearSessionCookie(),
        },
      },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return Response.json({ error: 'Não foi possível sair.' }, { status: 500 });
  }
}
