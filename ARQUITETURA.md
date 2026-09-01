# Painel de Fila TiFlux — decisões de produto e arquitetura

## Objetivo e problemas considerados

O painel é uma superfície operacional compartilhada para uma equipe de suporte. A fila não pode depender do navegador de uma pessoa, nem avançar duas vezes quando dois operadores agirem quase simultaneamente.

Situações tratadas no desenho:

- suporte ocupado, pausado, ausente, desativado ou temporariamente indisponível;
- pessoas indisponíveis preservam sua posição relativa, mas são ignoradas na escolha do próximo elegível;
- pular a vez move o suporte para o fim e registra o motivo;
- pegar atendimento move o suporte para o fim, muda seu status para ocupado e abre um atendimento;
- encerrar atendimento registra duração e torna o suporte disponível novamente;
- transferir fecha a responsabilidade do suporte de origem e abre a do destino sem contar um novo atendimento recebido;
- ticket informado é único entre atendimentos abertos, evitando duas pessoas pegarem o mesmo ticket;
- toda mutação usa controle de versão da fila; uma gravação concorrente perde a disputa e o cliente atualiza os dados antes de tentar novamente.

## Regras da fila

1. A ordem inicial é HENRIQUE, ARTHUR, VITOR, PABLO, BRUNO, LUCAS e AMARAL.
2. O próximo é o primeiro suporte ativo e com status `available` na ordem persistida.
3. Estados `busy`, `paused` e `away` não removem a pessoa da fila; apenas a tornam inelegível.
4. Ao pegar um atendimento, a pessoa selecionada vai para o fim da fila.
5. Ao pular, a pessoa vai para o fim sem aumentar sua contagem de atendimentos.
6. Ao voltar, muda para disponível e permanece em sua posição relativa.
7. Se ninguém estiver elegível, o painel mostra fila sem próximo em vez de alterar a ordem.
8. Resetar restaura a ordem inicial dos integrantes ativos e zera apenas a rotação, nunca apaga o histórico.

## Persistência e concorrência

O banco é SQLite/D1. As operações passam por uma pequena camada de domínio no servidor. A tabela singleton `queue_state` mantém a versão corrente. Cada comando escreve com `WHERE version = ?`; se nenhuma linha for alterada, ocorreu concorrência e a operação retorna conflito HTTP 409.

Tabelas principais:

- `support_agents`: cadastro, status, ativação e posição atual;
- `queue_state`: versão da rotação e horário da última alteração;
- `tickets`: atendimentos abertos e encerrados, origem manual ou futura integração;
- `events`: histórico imutável de ações;
- `settings`: configurações operacionais futuras sem acoplar o domínio ao TiFlux.

Índices atendem as consultas do painel (ordem ativa, eventos do dia, tickets abertos) e um índice único parcial protege o identificador de ticket enquanto estiver aberto.

## Integração futura com TiFlux

O núcleo recebe comandos normalizados (`claim`, `transfer`, `close`, `skip`, `status-change`) e registra a origem (`manual` ou `tiflux`). Uma integração futura deve apenas adaptar eventos reais do TiFlux para esses comandos; nenhum endpoint externo foi presumido.

## Telas

- **Operação:** próximo da fila, ações rápidas, fila completa, status da equipe, indicadores, ranking e histórico recente.
- **Administração:** adicionar/remover logicamente, ativar/desativar, reordenar, resetar, consultar histórico e estatísticas.

## Atualização

O cliente consulta o snapshot compartilhado periodicamente e imediatamente após cada ação. Essa estratégia é compatível com D1 hoje e pode ser substituída por eventos em tempo real sem mudar as regras do domínio.
