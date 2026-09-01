# Metre — regras de fila, autenticação e alertas

## Regra prioritária: ciclo oficial imutável

A ordem é fixa e tem prioridade sobre regras anteriores:

1. HENRIQUE
2. ARTHUR
3. VICTOR
4. PATRICK
5. PABLO
6. BRUNO
7. LUCAS
8. AMARAL
9. ANTONY
10. JOSÉ CARLOS

O banco continua armazenando uma posição para consulta, mas ela representa a posição
oficial e nunca é movimentada por um atendimento. O backend reaplica essas dez
posições durante a inicialização e considera somente esses integrantes no ciclo.
Não existem comandos de adicionar suporte à fila, reordenar, trocar prioridade,
colocar alguém no início/fim ou resetar para outra ordem, nem para administradores.

`fixed_queue_state.cursor_position` é o ponteiro do ciclo. Ao registrar um
atendimento ou pular uma vez, apenas o ponteiro avança. Se chegar ao fim, volta à
posição zero. Toda mutação usa a versão otimista de `queue_state`; uma requisição
concorrente perde a disputa com HTTP 409 e precisa ler o estado atualizado.

## Elegibilidade e pulos automáticos

Um integrante recebe a vez somente quando:

- seu acesso e registro de suporte estão ativos;
- seu status é `available`;
- existe presença recente, renovada pelo navegador autenticado a cada 20 segundos.

A presença expira após 60 segundos. `busy`, `paused`, `away`, inatividade e offline
tornam a pessoa inelegível apenas naquela passagem do ciclo. A posição oficial não
muda. O servidor percorre a ordem a partir do ponteiro até encontrar o próximo
elegível e registra um evento `automatic_skip` para cada pessoa ignorada, incluindo
motivo e destinatário efetivo. Se ninguém estiver elegível, o próximo fica vazio e
o ponteiro é preservado até alguém voltar.

O comando **Pular a vez** é uma decisão operacional manual, não exige senha e também
apenas avança o ponteiro. Alterar o próprio status não exige senha. Não existe pulo
automático por falta de resposta ao alerta enquanto o usuário continuar online e
disponível; nesse caso a equipe usa **Pular a vez** para manter a decisão auditável.

## Devolver uma retirada por engano

**Devolver para minha vez** desfaz somente a última retirada ainda segura:

1. `claim` registra a posição anterior do ponteiro, sequência e versão resultante.
2. A opção existe por 5 minutos e somente enquanto nenhuma outra mutação alterar a
   versão da fila.
3. A devolução restaura o ponteiro para aquele integrante sem mudar posição alguma.
4. `undo_claim` permanece no histórico e a retirada devolvida deixa de contar nos
   indicadores, sem apagar o evento original.

Uma retirada, pulo, status, mudança administrativa ou transição automática posterior
invalida a devolução antiga. Assim, um desfazer tardio não prejudica atendimentos que
já avançaram o ciclo.

## Contas, sessões e administração

Os dez integrantes oficiais recebem contas individuais ligadas aos respectivos
registros. Todos recebem a mesma senha inicial de suporte, mantida apenas no segredo
`SUPPORT_DEFAULT_PASSWORD`; o administrador pode redefini-la individualmente com no
mínimo 6 caracteres. O login inicial segue o nome normalizado; VICTOR usa `victor` e
JOSÉ CARLOS usa `jose.carlos`.

O administrador inicial usa o login `admin` e a senha já configurada no segredo
`ADMIN_QUEUE_PASSWORD`. Senhas persistidas usam PBKDF2-SHA256, 100 mil iterações e
salt aleatório. Sessões usam token aleatório em cookie `HttpOnly`, `Secure` e
`SameSite=Lax`; o banco guarda apenas o hash do token por 8 horas. Após cinco falhas,
o acesso fica bloqueado por 15 minutos.

Suporte pode consultar a fila, alterar apenas o próprio status, registrar apenas a
própria vez, pular a própria vez e devolver a própria retirada recente. Administrador
pode gerenciar logins, senhas e ativação, além de consultar histórico e estatísticas.
Alterações administrativas exigem sessão de administrador e confirmação da senha
administrativa no servidor. A reserva da alteração usa a versão atual do servidor,
sem rejeitar uma edição apenas porque a fila avançou enquanto a confirmação estava
aberta. Novos acessos podem ser administrativos; a equipe de suporte não pode ganhar
integrantes fora da sequência oficial.

A reconciliação automática de presença é oportunista: se outra requisição já estiver
com o bloqueio da fila, login e presença permanecem válidos e a próxima atualização
conclui a reconciliação. Assim, uma disputa interna não transforma um login válido em
erro para o usuário.

Criação, edição, redefinição de senha, login e logout são registrados em
`user_audit_log`; ações que interessam ao painel também entram em `events`.

## Tempo real e alerta de vez

Mudanças reais do próximo efetivo incrementam a sequência persistida. Clientes
recebem mudanças por Server-Sent Events e mantêm consulta periódica como contingência.
O alerta só pertence ao usuário cujo `agent_id` coincide com o próximo efetivo.

O navegador exige gesto do usuário para liberar áudio e notificações, portanto existe
**Ativar alertas**. O som é uma sequência curta de três notas, dura cerca de 1,4
segundo e nunca entra em repetição. **Parar som** interrompe imediatamente qualquer
nota ativa; **Entendi** para o som e registra o reconhecimento da sequência atual.
Uma nova sequência futura pode alertar novamente.

`localStorage` guarda apenas a preferência do dispositivo e a chave já reproduzida.
`BroadcastChannel` reduz duplicação entre abas do mesmo navegador. O estado
autoritativo da vez e dos reconhecimentos fica no D1. Som e Notification API exigem
a página aberta; aviso com navegador totalmente fechado exigiria Web Push, fora do
escopo desta versão.

## Persistência

- `support_agents`: integrantes oficiais, status e posições fixas;
- `queue_state`: versão concorrente global;
- `fixed_queue_state`: ponteiro, sequência de alerta e próximo efetivo;
- `queue_presence`: última presença por suporte;
- `events`: auditoria operacional imutável;
- `app_users`, `auth_sessions`, `user_presence`, `turn_acknowledgements` e
  `user_audit_log`: autenticação, presença e auditoria de acesso;
- `tickets`: estrutura preservada para integração futura, fora do fluxo atual.
