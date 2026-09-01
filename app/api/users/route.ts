import {
  assertSameOrigin,
  AuthError,
  listManagedUsers,
  requireAdmin,
  requireSession,
} from '@/lib/auth-store';
import { QueueError } from '@/lib/queue-store';
import { saveManagedUser, type UserAdminInput } from '@/lib/user-admin-store';

export async function GET(request: Request) {
  try {
    const user = await requireSession(request);
    requireAdmin(user);
    const users = await listManagedUsers();
    return Response.json({ users }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AuthError || error instanceof QueueError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return Response.json({ error: 'Não foi possível carregar os usuários.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSession(request);
    requireAdmin(user);
    const body = (await request.json()) as UserAdminInput;
    const result = await saveManagedUser(body, user);
    const users = await listManagedUsers();
    return Response.json({ ...result, users });
  } catch (error) {
    if (error instanceof AuthError || error instanceof QueueError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return Response.json({ error: 'Não foi possível salvar o usuário.' }, { status: 500 });
  }
}
