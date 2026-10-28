import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const generatedConfigPath = resolve(
  projectRoot,
  'dist/server/wrangler.json',
);
const productionConfigPath = resolve(
  projectRoot,
  'dist/server/wrangler.production.json',
);
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();
if (!databaseId) {
  throw new Error(
    'Defina CLOUDFLARE_D1_DATABASE_ID com o ID do banco D1 de produção.',
  );
}

const workerName =
  process.env.CLOUDFLARE_WORKER_NAME?.trim() || 'metre-fila-atendimento';
const databaseName =
  process.env.CLOUDFLARE_D1_DATABASE_NAME?.trim() ||
  'metre-fila-production';

const config = JSON.parse(await readFile(generatedConfigPath, 'utf8'));
config.name = workerName;
config.topLevelName = workerName;
config.d1_databases = [
  {
    binding: 'DB',
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: '../../drizzle',
  },
];
config.observability = { enabled: true };
config.workers_dev = true;
config.preview_urls = true;

await writeFile(productionConfigPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Configuração Cloudflare preparada para o Worker ${workerName}.`);
