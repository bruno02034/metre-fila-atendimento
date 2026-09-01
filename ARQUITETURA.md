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

## Devolver uma retirada por engano

A devolução é um desfazer seguro da retirada mais recente, não uma ação genérica de colocar alguém no início da fila.

1. Ao pegar um atendimento, o evento `claim` registra a ordem completa anterior e a versão da fila produzida pela retirada.
2. A opção **Devolver para minha vez** fica disponível por 5 minutos somente para a retirada global mais recente.
3. A devolução só é aceita se a versão atual ainda for exatamente a versão produzida por aquela retirada. Portanto, qualquer nova retirada, pulo, mudança de status, reordenação, ativação, desativação ou reset invalida a opção.
4. Ao confirmar, todas as posições são restauradas a partir da ordem registrada no evento original, garantindo que nenhuma outra pessoa ganhe ou perca posição.
5. O evento original permanece no histórico e um novo evento `undo_claim` registra quem devolveu, quando devolveu e qual retirada foi desfeita.
6. A retirada devolvida deixa de contar nos indicadores e no ranking do dia, sem apagar nenhum registro de auditoria.
7. Depois do prazo ou de qualquer alteração posterior, não existe desfazer automático. Uma eventual correção tardia exige tratamento administrativo separado, para não reescrever silenciosamente uma fila que outras pessoas já utilizaram.

No cenário de múltiplos atendimentos, a segunda retirada incrementa a versão da fila e invalida imediatamente a devolução da primeira. Isso prioriza a justiça da sequência já observada pela equipe.

## Persistência e concorrência

O banco é SQLite/D1. As operações passam por uma pequena camada de domínio no servidor. A tabela singleton `queue_state` mantém a versão corrente. Cada comando escreve com `WHERE version = ?`; se nenhuma linha for alterada, ocorreu concorrência e a operação retorna conflito HTTP 409.

Tabelas principais:

- `support_agents`: cadastro, status, ativação e posição atual;
- `queue_state`: versão da rotação e horário da última alteração;
- `tickets`: estrutura preservada para compatibilidade e possível integração futura, fora do fluxo atual;
- `events`: histórico imutável de ações;
- configurações futuras podem ser adicionadas sem acoplar o domínio ao TiFlux.

Índices atendem as consultas do painel, especialmente ordem ativa e eventos do dia.

## Autorização administrativa

Os comandos `claim` (**Peguei atendimento**), `undo-claim` (**Devolver para minha vez**), `skip` (**Pular a vez**) e `status` (**Alterar status**) pertencem ao fluxo normal e não pedem senha. Os comandos administrativos — adicionar, ativar/desativar, reordenar, transferir, encerrar manualmente e resetar — exigem autorização administrativa no servidor.

A senha é recebida por um campo do tipo `password`, enviada apenas na requisição da ação e comparada no servidor com o segredo `ADMIN_QUEUE_PASSWORD`. O valor não é persistido, não integra o código do navegador e nunca é incluído nos eventos. A comparação usa resumos SHA-256 e o backend rejeita a ação antes de adquirir o bloqueio da fila quando a autorização estiver ausente ou incorreta.

Cada comando protegido acrescenta `authorizedBy: administrator` e `authorizationMethod: password` aos detalhes do evento correspondente, mantendo data, horário, ação e suporte afetado no histórico auditável.

## Integração futura com TiFlux

O fluxo atual usa comandos normalizados de rotação e disponibilidade (`claim`, `undo-claim`, `skip` e `status`). Uma integração futura pode adaptar eventos reais do TiFlux para esses comandos; nenhum endpoint externo foi presumido.

## Telas

- **Operação:** próximo da fila, avanço direto, devolução segura da retirada mais recente, fila completa, status da equipe, indicadores, ranking e histórico recente.
- **Administração:** adicionar/remover logicamente, ativar/desativar, reordenar, resetar, consultar histórico e estatísticas.

## Atualização

O cliente consulta o snapshot compartilhado periodicamente e imediatamente após cada ação. Essa estratégia é compatível com D1 hoje e pode ser substituída por eventos em tempo real sem mudar as regras do domínio.
