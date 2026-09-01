# Painel de Fila TiFlux — decisões de produto e arquitetura

## Objetivo e problemas considerados

O painel é uma superfície operacional compartilhada para uma equipe de suporte. A fila não pode depender do navegador de uma pessoa, nem avançar duas vezes quando dois operadores agirem quase simultaneamente.

Situações tratadas no desenho:

- suporte ocupado, pausado, ausente, desativado ou temporariamente indisponível;
- pessoas indisponíveis preservam sua posição relativa, mas são ignoradas na escolha do próximo elegível;
- pular a vez move o suporte para o fim e registra o motivo;
- pegar atendimento move o suporte para o fim e registra quem assumiu, sem pedir ticket ou cliente;
- a disponibilidade continua sendo controlada manualmente pelo status da equipe;
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
- `tickets`: estrutura preservada para compatibilidade e possível integração futura, fora do fluxo atual;
- `events`: histórico imutável de ações;
- configurações futuras podem ser adicionadas sem acoplar o domínio ao TiFlux.

Índices atendem as consultas do painel, especialmente ordem ativa e eventos do dia.

## Integração futura com TiFlux

O fluxo atual usa comandos normalizados de rotação e disponibilidade (`claim`, `skip` e `status`). Uma integração futura pode adaptar eventos reais do TiFlux para esses comandos; nenhum endpoint externo foi presumido.

## Telas

- **Operação:** próximo da fila, avanço direto, fila completa, status da equipe, indicadores, ranking e histórico recente.
- **Administração:** adicionar/remover logicamente, ativar/desativar, reordenar, resetar, consultar histórico e estatísticas.

## Atualização

O cliente consulta o snapshot compartilhado periodicamente e imediatamente após cada ação. Essa estratégia é compatível com D1 hoje e pode ser substituída por eventos em tempo real sem mudar as regras do domínio.
