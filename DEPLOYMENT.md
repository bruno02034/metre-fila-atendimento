# Implantação gratuita na Cloudflare

Este projeto é uma aplicação full-stack React/Vinext para Cloudflare Workers e
usa Cloudflare D1. A implantação abaixo mantém a arquitetura atual e não grava
senhas no repositório.

## Pré-requisitos

- Conta gratuita na Cloudflare.
- Repositório GitHub atualizado.
- Node.js 22.13 ou superior e pnpm.
- Acesso ao banco atual caso os dados existentes precisem ser migrados.

## 1. Autenticar a CLI

```powershell
pnpm exec wrangler login
pnpm exec wrangler whoami
```

## 2. Criar o banco D1

```powershell
pnpm exec wrangler d1 create metre-fila-production --location enam
```

Guarde o `database_id` exibido. O identificador não é uma senha, mas as
credenciais do banco e do Worker nunca devem ser gravadas no Git.

## 3. Preparar o ambiente local

Crie um arquivo `.env` local, que já é ignorado pelo Git:

```dotenv
CLOUDFLARE_D1_DATABASE_ID=cole-o-database-id-aqui
CLOUDFLARE_D1_DATABASE_NAME=metre-fila-production
CLOUDFLARE_WORKER_NAME=metre-fila-atendimento
```

No PowerShell, carregue as variáveis para a sessão antes dos comandos:

```powershell
$env:CLOUDFLARE_D1_DATABASE_ID = "cole-o-database-id-aqui"
$env:CLOUDFLARE_D1_DATABASE_NAME = "metre-fila-production"
$env:CLOUDFLARE_WORKER_NAME = "metre-fila-atendimento"
```

## 4. Gerar o artefato e aplicar o schema

```powershell
pnpm run build:cloudflare
pnpm exec wrangler d1 migrations apply DB --remote --config dist/server/wrangler.production.json
```

As migrações são transacionais. O D1 também mantém recuperação por ponto no
tempo no plano gratuito. Não aplique importações de dados sobre o banco atual
sem antes validar um backup.

## 5. Configurar segredos

```powershell
pnpm exec wrangler secret put ADMIN_QUEUE_PASSWORD --config dist/server/wrangler.production.json
pnpm exec wrangler secret put SUPPORT_DEFAULT_PASSWORD --config dist/server/wrangler.production.json
```

Digite os valores somente no prompt da Cloudflare. Eles não serão adicionados
ao código nem ao histórico do Git.

## 6. Publicar

```powershell
pnpm run deploy:cloudflare
```

Ao final, o Wrangler informa a URL pública no domínio `workers.dev`.

## 7. Validar

Abra as rotas abaixo na URL publicada:

- `/api/health` deve retornar `status: ok` e `database: ok`.
- `/login` deve abrir a tela de acesso.
- `/` deve redirecionar para o login quando não houver sessão.
- `/admin` deve exigir autenticação adequada.

Use os logs em tempo real durante o teste:

```powershell
pnpm exec wrangler tail metre-fila-atendimento
```

## 8. Integração com GitHub

No painel Cloudflare, acesse **Workers & Pages > Create application**, conecte
o repositório GitHub e configure:

- Branch de produção: `main`
- Build command: `pnpm run build:cloudflare`
- Deploy command: `pnpm exec wrangler deploy --config dist/server/wrangler.production.json`
- Build variable: `CLOUDFLARE_D1_DATABASE_ID`
- Build variable: `CLOUDFLARE_D1_DATABASE_NAME=metre-fila-production`
- Build variable: `CLOUDFLARE_WORKER_NAME=metre-fila-atendimento`

Os segredos de runtime continuam cadastrados em **Settings > Variables and
Secrets** como secretos. Não os cadastre como variáveis públicas de build.

## Dados existentes

O banco D1 criado acima começa vazio. A aplicação atual continua intacta até a
troca definitiva de URL. Para preservar os dados, exporte o banco atual para
SQL, importe primeiro em um banco D1 de teste e compare contagens e funções
principais. A migração do banco atual deve ser tratada separadamente porque o
banco da hospedagem Sites não pertence automaticamente à conta Cloudflare.

## Limites do plano gratuito

- 100.000 requisições de Worker por dia.
- 10 ms de CPU por requisição.
- D1: 5 milhões de linhas lidas e 100.000 linhas escritas por dia.
- D1: banco de até 500 MB e 5 GB totais por conta.
- Recuperação por ponto no tempo por 7 dias.

O Worker não é suspenso por inatividade, mas o plano gratuito não oferece SLA
contratual. Ao atingir uma cota diária, as operações podem falhar até a
renovação do limite.
