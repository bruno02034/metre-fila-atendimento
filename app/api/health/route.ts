import { env } from 'cloudflare:workers';

export async function GET() {
  try {
    const result = await env.DB.prepare('SELECT 1 AS healthy').first<{
      healthy: number;
    }>();
    if (result?.healthy !== 1) throw new Error('database_check_failed');

    return Response.json(
      {
        status: 'ok',
        database: 'ok',
        checkedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('health_check_failed', error);
    return Response.json(
      {
        status: 'error',
        database: 'unavailable',
        checkedAt: new Date().toISOString(),
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
