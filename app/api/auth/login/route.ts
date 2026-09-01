import {
  assertSameOrigin,
  AuthError,
  loginUser,
  sessionCookie,
} from '@/lib/auth-store';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { login?: unknown; password?: unknown };
    const { user, token } = await loginUser(body.login, body.password, request);
    return Response.json(
      { user },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Set-Cookie': sessionCookie(token),
        },
      },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return Response.json({ error: 'Não foi possível entrar.' }, { status: 500 });
  }
}
