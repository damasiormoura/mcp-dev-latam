# Tools de leitura do MCP Omie — validação em produção

_Data: 2026-09-27 (22h30–23h50 UTC). Servidor em produção no conector:
`mcp-omie` 0.8.2 (as 47 tools de leitura abaixo). As correções deste relatório
saem na **0.9.1**, feita sobre a 0.9.0 (que chegou ao `main` durante o
trabalho)._

## Como foi feito

- **Só leitura.** Foram 321 chamadas, uma de cada vez, todas pelo conector
  Omie da sessão, e somente às 47 tools de leitura da lista. Nenhuma tool de
  escrita foi chamada. `get_pix_qrcode` foi chamada uma única vez. Não houve
  acesso a credenciais nem aos servidores.
- **Uma propriedade, duas chamadas.** Para cada propriedade do `inputSchema`,
  comparei a chamada com o campo e sem ele (ou com dois valores) e registrei
  contagens e IDs internos da Omie. Onde a conta não tem dados que provem o
  efeito, a matriz diz isso.
- **Doc oficial.** Conferi cada método com `python3 scripts/omie-doc.py show
  <endpoint>`. Onde a doc não confirma um comportamento, a descrição da tool
  agora diz o que foi visto em produção, sem supor mais do que isso.
- **Sem dados pessoais.** Nenhum CNPJ, CPF, nome, e-mail ou telefone foi
  copiado para cá. Os filtros por nome ou documento aparecem como
  `<trecho do nome>`, `<CNPJ formatado>` e assim por diante.
- **Erros da Omie.** Nenhum REDUNDANT. `ListarLancCC` respondeu duas vezes
  `Client-1880` ("Já existe uma requisição desse método sendo executada"), por
  concorrência do lado da Omie. Segui adiante e repeti a chamada mais tarde, com
  sucesso. Nas tools sem dados parei no segundo ou terceiro erro seguido, para
  não arriscar o bloqueio da App Key.

**Legenda da coluna Resultado**

| | Significado |
|---|---|
| ✅ | A propriedade chega à Omie e tem o efeito que a descrição diz. |
| ❌ | Bug: a propriedade não tem efeito, a chamada falha, ou a descrição afirma algo falso. A evidência diz se foi **corrigido (0.9.1)** ou só **documentado** (comportamento da Omie que o servidor não pode mudar). |
| ⚠️ | A descrição era imprecisa (incompleta ou enganosa), ou **sem dados**: a conta não tem registros que provem o efeito. Nesse caso a propriedade fica provada só pelos testes da camada 2. |

## Resumo

Das **330 propriedades** das 47 tools: **249 ✅**, **68 ⚠️** (45 delas
sem dados, 23 com descrição imprecisa) e **13 ❌**. Há ainda 15 linhas sobre
a tool como um todo (descrição, resposta, chamada sem argumentos): 9 ❌, 4 ⚠️ e
2 ✅. A [contagem por tool](#contagem) está no fim. As 7 propriedades das
duas tools e do campo que chegaram na 0.9.0 não foram chamadas (seção
[Fora da validação ao vivo](#fora-da-validação-ao-vivo)).

### O que funcionou

- Todas as 47 tools respondem com argumentos reais. Paginação, filtros por ID,
  por código de integração, por data de emissão, vencimento, pagamento e
  cancelamento, filtros por status e por cliente: todos têm efeito e
  devolvem o que a descrição promete.
- Os **fatos conhecidos** se confirmaram, todos:
  - `list_open_titles` cobre um dia só e devolve `nDiasAtraso` 0. No domingo
    27/09, o título 5962783931, vencido na sexta 25/09, veio como "Atrasado
    desde 25/09" com `nDiasAtraso` 0.
  - `list_financial_movements` com `cStatus` envia `cTpLancamento` CR/CP/CPCR:
    R + ATRASADO trouxe 2 títulos, só títulos.
  - `list_products` envia `filtrar_apenas_omiepdv="N"`: 213 produtos, contra 0
    com "S".
  - `list_invoices` com as duas flags pede a NF completa e remove `det`
    (NF 3995: `pedido` e `titulos` vêm, `det` não).
  - `cUrlLogoBanco` é removido (`list_open_titles`, `get_finance_summary`) e as
    entidades HTML são decodificadas (produto 5955136352).
  - Condições de pagamento: 000 = "A Vista", 001 = "1 Parcela",
    999 = "Informar o número de parcelas" (`nParcelas` 999).
  - As anotações `readOnlyHint` não são bug: não mexi nelas.

### Bugs corrigidos no servidor (código, 0.9.1)

| # | Tool | O que acontecia | Correção |
|---|---|---|---|
| 1 | `list_invoices` | `filtrar_por_data_de/ate` sozinhos eram ignorados pela Omie: 453 NFs, igual a sem filtro. Com qualquer das duas flags vinham 9. | O param builder envia `filtrar_apenas_alteracao="S"` quando há janela e nenhuma flag. |
| 2 | `get_finance_summary` | Sem argumentos o `param` ia `{}` e a Omie respondia `Client-71` "Nenhum parâmetro foi recebido em WS_PARAMS!". A descrição prometia "hoje por padrão". | Envia `lApenasResumo: true` (o padrão documentado pela Omie) quando ausente. |
| 3 | `get_bank_statement` | Sem `nCodCC` nem `cCodIntCC` a chamada ia à Omie e voltava `Client-1002`. | `anyOfRequired: ["nCodCC", "cCodIntCC"]`: recusada localmente, antes da Omie. |
| 4 | `list_customers_summary` | `clientesPorCodigo` não tinha `items` e a descrição dizia "lista de códigos": `[5951279344]` voltava `Client-1000`. | `items` é um objeto com `codigo_cliente_omie` / `codigo_cliente_integracao` e `anyOfRequired`. Um número solto é recusado localmente. |
| 5 | modo demo | As respostas de `list_customers`, `get_financial`, `get_bank_accounts`, `list_stock_locations` e `list_payment_terms` usavam chaves que a Omie não devolve. Pior: 999 aparecia como "A vista". | Respostas refeitas com as chaves reais (`codigo_cliente_omie`, `codigo_lancamento_omie`, `descricao`/`codigo_banco`, `locaisEncontrados`, `cadastros` com 000 e 999). |

### Descrições corrigidas (a descrição afirmava algo falso)

- **`list_order_stages`**: não lista as etapas configuradas. É o histórico de
  mudanças de etapa, uma linha por mudança (109 linhas para 27 pedidos; o
  pedido 5962530736 tem duas, etapas 60 e 70). As etapas configuradas estão em
  `ListarEtapasFaturamento` (`/produtos/etapafat/`), que o servidor não expõe.
  `change_order_stage` deixou de apontar para ela.
- **`list_financial_movements`**: saiu a afirmação "sem filtro de data, só os
  últimos 30 dias". A chamada sem filtro trouxe 127 linhas, a primeira emitida
  em 04/08 e paga em 10/08. A doc da Omie não fala de janela padrão; a
  afirmação vinha de `API-AUDIT.md` 2.6.
- **`list_cash_entries`**: a 0.8.2 dizia que as baixas não estavam aqui; 14 dos
  21 lançamentos são baixas (7 BAXP, 7 BAXR). A 0.9.0 já corrigiu. Aqui foi
  acrescentado que BAXR/BAXP não constam da doc, e o significado dos códigos
  de `cOrigem`.
- **`get_stock_position`**: não é "saldo zero fica de fora". Um item com saldo
  0 e com movimento aparece. O que `cExibeTodos` inclui são os itens **sem
  movimento**, como diz a doc: 47 → 213.
- **`get_bank_statement`**: não é "como conciliado na Omie". O extrato traz os
  lançamentos não conciliados também (`cSituacao`).
- **`get_finance_summary`**: `dDia` não move os saldos, só o início do fluxo de
  caixa. `lExibirCategoria` só tem efeito com `lApenasResumo=false`.
- **`list_customers` / `list_customers_summary`** (`clientesFiltro`): a Omie
  ignora `estado`, `cidade`, `email`, `bairro`, `cep`, `endereco`, as
  inscrições, `pessoa_fisica`, `optante_simples_nacional` e `contato` (sempre
  238). A descrição agora lista as chaves que filtram.
- **`list_customers_summary`**: `exibir_obs` não tem efeito na forma resumida,
  e as linhas trazem `codigo_cliente`, não `codigo_cliente_omie`.
- **`simulate_order_taxes`**: sem `det_simul[].codigo_cenario_impostos_item` a
  Omie recusa ("O Cenário de impostos precisa ser preenchido"), embora a doc
  marque o campo como opcional.

### Bugs da Omie só documentados (o servidor não pode mudar; a descrição agora diz)

- `list_stock_movements` corta o período em cerca de 60 dias a partir de
  `dDtInicial`, sem avisar. 15/07–27/09 trouxe 42 de 63 movimentos, tudo até
  13/09; 01/01–27/09 não trouxe nada.
- `get_stock_position` com `cExibeTodos="S"` ignora `nRegPorPagina` e pagina de
  50 em 50.
- `ordenar_por="DESCRICAO"` em `list_products` e `cOrdenarPor` /
  `cOrdemDecrescente` em `list_services` não mudam a ordem.
- `list_payment_terms`: `apenas_importado_api="S"` devolve os 36 termos, como
  sem o filtro.
- `list_accounts_payable`: PAGO e LIQUIDADO também casam um título pago e
  depois cancelado (21 + 7 + 3 > 29).
- `get_boleto`: um título não encontrado volta HTTP 200 com `cCodStatus`
  "103", e a leitura bem-sucedida diz "Boleto gerado com sucesso!".
- `get_pix_qrcode`: só uma conta Omie.CASH tem QR estático. Para as outras a
  Omie responde `cCodStatus` "719".
- `list_stock_movements`: `codigo_local_estoque` e `lista_local_estoque` juntos
  são recusados (`Client-1073`).
- Outros comportamentos, agora nas descrições:
  - `list_invoices`: `cSerie` compara texto exato ("1" ≠ "001": 426 contra 22).
  - `list_products`: `filtrar_apenas_descricao` exige 3 caracteres além do `%`.
  - `list_services`: `cDescricao` casa o começo da descrição (`%` para
    qualquer parte).
  - `get_invoice_pdf`: o XML vem inline, não como link.
  - `create_invoice`: `cnpj_cpf` e `tpNF` sozinhos são recusados.
  - `list_orders`: `apenas_resumo` tira `total_pedido`.
  - `get_financial`: as linhas escrevem "A VENCER", com espaço.
  - `filtrar_apenas_alteracao` = janela simples (registro novo conta como
    alterado; visto em 5 endpoints).
  - `list_salespeople`: o ID é `codigo`.
  - `list_order_stages`: aceita `nRegPorPagina` 100, embora a doc diga máx. 50.
- Só registrado aqui, sem mudança de descrição:
  - Um resultado vazio costuma vir como HTTP 500 `Client-5113` ("Não existem
    registros"), não como lista vazia. `ListarNFSEs` e `ListarContasReceber`
    devolvem `[]`.
  - `ListarEmpresas` devolve a página 1 para uma página além do fim;
    `ListarCategorias` e `ListarVendedores` devolvem 0 registros com total 0.
  - `get_bank_accounts` com só `filtrar_por_data_ate` responde `Client-101`
    "Nenhuma conta corrente foi encontrada!".
  - `validate_order` / `validate_service_order` devolvem `cCodIntPed` /
    `cCodIntOS` como 60 espaços quando o registro não tem código.
  - `list_customers` traz `cDesStatus` " Elapsed time: …" como ruído.
  - `get_finance_summary`: `contaReceberAtraso` lista 1 dos 2 títulos
    ATRASADO (5962783931 fica fora, e `vAtraso` soma só 4.250).

### Dados do ERP (só relatados, não mexi)

- Saldos de estoque negativos em `get_stock_position` (físico −3 e −1).
- Título a pagar 1598355680: `status_titulo` CANCELADO, mas `resumo`
  `cLiquidado` S e `nValPago` 1.100 (pago e depois cancelado). É a causa da
  sobreposição PAGO/LIQUIDADO.
- Título a receber 5962772133 (1.550): ligado à NF 3991 (750), com observação
  "A CANCELAR – título duplicado".
- A conta Omie.CASH (nCodCC 5950680322) está inativa. Por isso nenhuma conta
  gera QR estático.

### Sem dados para provar (⚠️ sem dados)

A conta não tem pedidos de compra (`list_purchase_orders`,
`get_purchase_order`), PIX (`list_pix`, `get_pix_status`), projetos
(`list_projects`), OS com produtos ou despesas, rateio por departamento, nem
mais de um vendedor, empresa ou local de estoque. Nesses campos a chamada chega
à Omie sem erro de schema, mas o efeito não pôde ser visto. Os testes da
camada 2 provam que cada um chega ao `param` com o nome e o valor certos.

### Fora da validação ao vivo

A 0.9.0 (conciliação bancária) acrescentou duas tools de leitura,
`get_cash_entry` e `list_unreconciled_entries`, e o campo `nCodMovCC` em
`list_financial_movements`. Não estão na lista das 47 autorizadas. O conector,
reconectado às 23h47, já as listava, mas **não foram chamadas**. Estão
cobertas só pelos testes: `index.test.ts` (a junção, na 0.9.0),
`reconciliation.test.ts` e `read-tools.test.ts` (nesta PR).

A 0.9.2 acrescentou `get_service_order_status` (`StatusOS`). Ela foi validada
ao vivo à parte, em 2026-10-03: ver
[0.9.2 — `get_service_order_status`](#092--get_service_order_status).

## Camada 2 — testes

| Arquivo | O que prova |
|---|---|
| `src/__tests__/read-tools.test.ts` | As 50 tools de leitura (as 47, as 2 da 0.9.0 e a da 0.9.2). A chamada mínima envia exatamente os padrões do builder, e cada propriedade declarada chega ao `param` com o próprio nome e valor, gerada do schema. Também: padrões que dependem do resto, restrições de schema achadas ao vivo, 18 fixtures de produção anonimizadas com teste de regressão cada, as descrições corrigidas e as respostas do modo demo. |
| `src/__tests__/fixtures/live/*.json` | 18 respostas reais anonimizadas: CNPJ, CPF, nomes, e-mails, telefones, chaves de NF-e e códigos de barras trocados por valores sintéticos. Um teste recusa CNPJ ou e-mail fora do padrão sintético. |
| `src/__tests__/reconciliation.test.ts` | Bordas da junção de `list_unreconciled_entries`: extrato sem linhas, linha sem situação, página de baixas vazia, limite de 10 páginas. |
| `src/__tests__/cancellation.test.ts` | Bordas da guarda de `cancel_account_receivable` (entra na meta de 100% de `src/tools/**`). |
| `src/__tests__/http-transport.test.ts` | Transporte HTTP e stdio de `src/index.ts`: OAuth, sessões, varredura por ociosidade e sinais. |
| `src/__tests__/tool-registry.test.ts` | Nome de tool duplicado derruba o registro. |
| `src/__tests__/omie.test.ts` (+) | Variantes de `OmieApiError`, `decodeEntities` e as guardas restantes de `validateArgs`. |

Cobertura (`npm run coverage:omie`, `@vitest/coverage-v8`, limite de 100%
exigido na linha de comando): **100% de linhas, ramos, funções e statements**
em `src/tools/**`, `src/index.ts` e `src/omie.ts`.

## Matriz tool × propriedade

Cada linha mostra os argumentos usados, o resultado e a evidência (contagens e
IDs internos da Omie). "reg" = `registros_por_pagina` / `nRegPorPagina`.

### Clientes

| Tool | Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|---|
| list_customers | pagina | reg=1, pagina=2 | ✅ | pagina 2 de 238; linha 5951279344 |
| list_customers | registros_por_pagina | reg=1 | ✅ | 1 linha, total_de_paginas 238 |
| list_customers | clientesFiltro.codigo_cliente_omie | ID | ✅ | 1 de 238 |
| list_customers | clientesFiltro.codigo_cliente_integracao | código | ✅ | 1 de 238 |
| list_customers | clientesFiltro.razao_social | `<início>`; `<trecho do meio>` | ✅ | 1 e 1 (busca por "contém") |
| list_customers | clientesFiltro.nome_fantasia | `<nome fantasia>` | ✅ | 1 |
| list_customers | clientesFiltro.cnpj_cpf | `<CNPJ formatado>`; `<só dígitos>` | ✅ | 1 e 1 (mesmo filtro, via list_customers_summary) |
| list_customers | clientesFiltro.inativo | "S" | ✅ | 5 |
| list_customers | clientesFiltro.tags | `[{tag:"Fornecedor"}]` | ✅ | 20 |
| list_customers | clientesFiltro: estado, cidade (nome e IBGE), email (parcial e exato), bairro, cep, endereco, inscricao_estadual, inscricao_municipal, pessoa_fisica, optante_simples_nacional, contato | um de cada vez, reg=1 | ❌ | todos 238 = sem filtro, a primeira linha não muda; `pessoa_fisica=S` não isola a PF 5951284988. **Documentado**: a descrição lista as chaves que filtram e diz que a Omie ignora as outras |
| get_customer | codigo_cliente_omie | 5960133379 | ✅ | registro, com `observacao` |
| get_customer | codigo_cliente_integracao | "5951279343" | ✅ | codigo_cliente_omie 5951279344 |
| list_customers_summary | pagina | pagina=2, reg=1 | ✅ | pagina 2 de 238; codigo_cliente 5951279344 |
| list_customers_summary | registros_por_pagina | reg=2 | ✅ | 2 linhas, total 238 |
| list_customers_summary | (resposta) | — | ⚠️ | linhas trazem `codigo_cliente` (não `codigo_cliente_omie`) e 5 campos. **Corrigido**: a descrição nomeia os campos |
| list_customers_summary | filtrar_por_data_de | 20/09 | ✅ | 16 |
| list_customers_summary | filtrar_por_data_ate | 20/09–22/09 | ✅ | 13 |
| list_customers_summary | filtrar_apenas_inclusao | de 20/09 + "S" | ✅ | 10 |
| list_customers_summary | filtrar_apenas_alteracao | de 20/09 + "S" | ⚠️ | 16 = sem flag (registro novo conta como alterado). **Corrigido** na descrição |
| list_customers_summary | clientesFiltro | cnpj_cpf formatado / só dígitos; estado=MG | ✅ / ❌ | 1 / 1; estado → 238 (ignorado). **Documentado** (mesma descrição de list_customers) |
| list_customers_summary | clientesPorCodigo | `[5951279344]` (número) | ❌ | HTTP 500 Client-1000 "O preenchimento da tag [codigo_cliente_omie] ou [codigo_cliente_integracao] é obrigatório!". **Corrigido**: `items` objeto + anyOfRequired |
| list_customers_summary | clientesPorCodigo[].codigo_cliente_omie | `[{codigo_cliente_omie:5951279344}]` | ✅ | 1 |
| list_customers_summary | clientesPorCodigo[].codigo_cliente_integracao | `[{codigo_cliente_integracao:"5951279343"}]` | ✅ | 1 (codigo_cliente 5951279344) |
| list_customers_summary | apenas_importado_api | "S" | ✅ | 193 de 238 |
| list_customers_summary | exibir_obs | "S" | ❌ | linhas idênticas (a forma resumida não tem observação). **Documentado**: "aceito, sem efeito aqui" |

### Produtos

| Tool | Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|---|
| list_products | pagina | pagina=2, reg=1 | ✅ | pagina 2 de 213; 5955136354 (p. 1: 5955136352) |
| list_products | registros_por_pagina | reg=1 | ✅ | 213 páginas |
| list_products | filtrar_apenas_omiepdv | padrão do servidor "N"; "S" | ✅ | 213 contra 0 (fato conhecido) |
| list_products | filtrar_apenas_descricao | "%PRESSOSTATO%"; "PRESSOSTATO"; "%LGW 50 A4"; "A%" | ⚠️ | 14; exato → Client-5113 (0); "termina com" → 1 (5955136378); "A%" → Client-1010 "mínimo de três caracteres". **Corrigido**: a descrição diz o mínimo |
| list_products | filtrar_apenas_familia | "123456" | ✅ | Client-5113 (0 de 213): filtro aplicado |
| list_products | inativo | "S" | ✅ | 9 (a listagem padrão inclui os 9) |
| list_products | apenas_importado_api | "S" | ✅ | 49 |
| list_products | ordem_decrescente | "S" | ✅ | primeiro 5967915606 (crescente: 5955136352) |
| list_products | ordenar_por | "DESCRICAO"; + desc | ❌ | mesma ordem do padrão (código); com desc o primeiro não é o último alfabético. A doc não lista valores. **Documentado** |
| list_products | filtrar_por_data_de | 20/09 | ✅ | 16 |
| list_products | filtrar_por_data_ate | 20/09–23/09 | ✅ | 6 |
| list_products | filtrar_apenas_inclusao | de 15/09 + "S" | ✅ | 24 de 32 |
| list_products | filtrar_apenas_alteracao | de 15/09 + "S" | ⚠️ | 32 = sem flag. **Corrigido** na descrição |
| list_products | (resposta) | reg=1 | ✅ | 5955136352: `&quot;` decodificado para `"` |
| get_product | codigo_produto | 5955136378 | ✅ | registro |
| get_product | codigo | "02496" | ✅ | codigo_produto 5967915606 |
| get_product | codigo_produto_integracao | "799495422358022" | ✅ | codigo_produto 5960133566 |

### Vendas e NF-e

| Tool | Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|---|
| list_orders | pagina | 20/09–21/09, pagina=2 | ✅ | pagina 2; 5966503168 |
| list_orders | registros_por_pagina | reg=2 | ✅ | total 27 |
| list_orders | filtrar_por_data_de | 20/09 | ✅ | 8 |
| list_orders | filtrar_por_data_ate | 20/09–21/09 | ✅ | 6 |
| list_orders | filtrar_apenas_inclusao | janela + "S" | ✅ | 4 |
| list_orders | filtrar_apenas_alteracao | janela + "S" | ⚠️ | 6 = sem flag. **Corrigido** na descrição |
| list_orders | ordenar_por | — | ⚠️ | sem dados: ordem por número = ordem por código nesta conta; a doc não lista valores |
| list_orders | etapa | "60" | ⚠️ | 17 ✅, mas 00 e 70 existem (5961789331 em 70) e a descrição listava só 10/20/50/60. **Corrigido** |
| list_orders | status_pedido | "CANCELADO" | ✅ | 1 (5961852861) |
| list_orders | filtrar_por_cliente | 5961454237 | ✅ | 2 |
| list_orders | filtrar_por_vendedor | 5961789333 | ✅ | 9 |
| list_orders | filtrar_por_projeto | 123456 | ✅ | Client-5113 (0): aplicado |
| list_orders | numero_pedido_de / _ate | 10–15; 1–5; 10–10 | ✅ | 5; 0; 1 (5962530736) |
| list_orders | data_previsao_de / _ate | 01/09–02/09 | ✅ | 3 |
| list_orders | data_faturamento_de / _ate | 03/09–03/09 | ✅ | 2 |
| list_orders | data_cancelamento_de / _ate | 03/09–30/09; 02/09–02/09 | ✅ | 0; 1 |
| list_orders | apenas_resumo | ausente vs "S" (pedido 10) | ⚠️ | sem: `det`, `lista_parcelas`, `total_pedido`, `departamentos`; com "S": nenhum. **Corrigido**: a descrição diz que `total_pedido` some |
| get_sales_order | codigo_pedido | 5970235059 | ✅ | numero 30, det[1] |
| get_sales_order | codigo_pedido_integracao | "PVOS634004216290242" | ✅ | codigo_pedido 5961852861, total_pedido 750 |
| get_order_status | codigo_pedido | 5962530736 | ✅ | etapa 70, faturada S, cancelada N, ListaNfe[1] |
| get_order_status | codigo_pedido_integracao | "PVOS634004216290242" | ✅ | codigo_pedido 5961852861, cancelada S |
| simulate_order_taxes | (sem cenário) | cliente 5970234379, produto 5965406408, qtd 1, 1600 | ❌ | HTTP 500 Client-9090 "O Cenário de impostos precisa ser preenchido.", embora a doc marque o campo como opcional. **Documentado**: a descrição manda enviar o cenário |
| simulate_order_taxes | codigo_cliente, det_simul, det_simul[].produto_simul, det_simul[].produto_simul.codigo_produto, det_simul[].produto_simul.valor_unitario, det_simul[].codigo_cenario_impostos_item | o mesmo + cenário 5956716128 | ✅ | valor_total 1600, base_pis 1600 |
| simulate_order_taxes | det_simul[].produto_simul.quantidade | 2 | ✅ | valor_total 3115 = 3200 − 200 + 115 |
| simulate_order_taxes | det_simul[].produto_simul.valor_desconto | 200 | ✅ | −200 no total |
| simulate_order_taxes | frete_simul, frete_simul.valor_frete / valor_seguro / outras_despesas | 100 / 10 / 5 | ✅ | +115 no total |
| simulate_order_taxes | consumidor_final | "S" vs "N" | ✅ | ecoado "S"; icms_sn e cfop mudam |
| validate_order | nCodPed | 5962530736; 5965284855 | ✅ | cCodStatus 1 "já foi autorizado"; "não pode ser faturado na etapa [00]" |
| validate_order | cCodIntPed | "PVOS572811483165256" | ✅ | nCodPed 5972131101 (sem código, volta como 60 espaços) |
| list_order_stages | (descrição) | reg=3 | ❌ | 109 linhas para 27 pedidos: é o **histórico** de mudanças de etapa, não as etapas configuradas (essas estão em ListarEtapasFaturamento, não exposto). **Corrigido** |
| list_order_stages | nPagina | reg=100, nPagina=2; nPagina=3 | ✅ | nTotPaginas 2, 9 de 109; página 3 → Client-5113 |
| list_order_stages | nRegPorPagina | 3; 100 | ✅ | 100 respeitado (a doc diz máx. 50) |
| list_order_stages | cOrdenarPor | "CODIGO"; "DATAHORA" + desc | ✅ | primeiro 5964671584 (padrão: 5965284855) |
| list_order_stages | cOrdemDecrescente | "CODIGO" + "S" | ✅ | primeiro 5972131101 |
| list_order_stages | nCodPed | 5962530736 | ✅ | 2 linhas: etapa 60 às 10:55, 70 às 18:46 |
| list_order_stages | cCodIntPed | "PVOS374575619524786" | ✅ | 2 (etapas 10 e 60) |
| list_order_stages | cEtapa | "70" | ✅ | 5 |
| list_order_stages | dDtInicial / dDtFinal | 24/09–27/09 | ✅ | 4 (data da mudança de etapa; descrição precisada) |
| list_invoices | pagina | cSerie "1", pagina=2 | ✅ | pagina 2 |
| list_invoices | registros_por_pagina | reg=1 | ✅ | 453 |
| list_invoices | filtrar_por_data_de / _ate | 20/09–27/09, sem flag | ❌ | 453 = sem filtro (1ª linha alterada em 27/08). **Corrigido**: o builder envia `filtrar_apenas_alteracao="S"` |
| list_invoices | filtrar_apenas_inclusao | janela + "S" | ✅ | 9 |
| list_invoices | filtrar_apenas_alteracao | janela + "S" | ✅ | 9 |
| list_invoices | ordenar_por | "DATA_LANCAMENTO" | ⚠️ | sem dados: mesma ordem do padrão |
| list_invoices | ordem_decrescente | "S" | ✅ | primeiro 5972736165 (crescente: 5960048313) |
| list_invoices | dEmiInicial / dEmiFinal | 01/09–03/09 | ✅ | 7 |
| list_invoices | dRegInicial / dRegFinal | 10/09–10/09 | ✅ | 3 |
| list_invoices | dSaiEntInicial / dSaiEntFinal | 02/06–02/06 | ✅ | 6 |
| list_invoices | dCanInicial / dCanFinal | 01/09–30/09 | ✅ | 1 |
| list_invoices | filtrar_por_status | "C" | ✅ | 1 (5961852873, cancelada 02/09) |
| list_invoices | tpNF | "0" | ✅ | 19 |
| list_invoices | cSerie | "001"; "1" | ⚠️ | 22 e 426: texto exato. **Corrigido** na descrição |
| list_invoices | nNFInicial / nNFFinal | 3990–3999 | ✅ | 10 |
| list_invoices | nIdCliente | 5961454237 | ✅ | 2 |
| list_invoices | cnpj_cpf | `<CNPJ formatado>` | ✅ | 2 |
| list_invoices | cNumeroPedidoCliente | `<nº do pedido do cliente>` | ✅ | 1 (5962533703) |
| list_invoices | opPedido | "11" | ✅ | 22 |
| list_invoices | cApenasResumo | "S" sozinho | ✅ | det [], pedido {}, titulos [] |
| list_invoices | cDetalhesPedido | NF 3995 + cApenasResumo "S" + "S" | ⚠️ | ✅ o servidor envia resumo "N" e tira det: pedido.cNumPedido "10", titulos[1] 5962533719. Mas a NF completa já traz `titulos` sem a flag. **Corrigido** na descrição |
| create_invoice | nCodNF | 5962533703 | ✅ | det[1], titulos[1] (5962533719) |
| create_invoice | nNF + serie | "3992" + "001" | ✅ | nIdNF 5961852873 |
| create_invoice | cChaveNFe | `<chave da NF 3991>` | ✅ | nIdNF 5961789366 |
| create_invoice | cDetalhesPedido | chave + "S" | ✅ | pedido.cNumPedido "6", det[0].itemPedido |
| create_invoice | nIdPedido | 5970235059 | ✅ | nIdNF 5970253843 |
| create_invoice | cnpj_cpf + tpNF | sozinhos; com nNF 590 + serie 1 + tpNF 0 + `<CNPJ do fornecedor>` | ⚠️ | sozinhos: Client-101 "Informe o Número da Nota, Chave ou Id do Pedido"; juntos: NF de entrada 5967433588. **Corrigido**: "só estreitam uma busca por nNF + serie" |
| get_invoice_pdf | nIdNfe | 5962533703 | ⚠️ | cPdf e cLinkPortal são links; cXmlNfe é o XML assinado inteiro inline (~8 KB). **Corrigido** na descrição |

### Compras

| Tool | Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|---|
| list_purchase_orders | nPagina, nRegsPorPagina | nRegsPorPagina=2 | ⚠️ | sem dados: Client-5113 (a conta não tem pedidos de compra) |
| list_purchase_orders | lExibirPedidosPendentes / Faturados / Recebidos / Cancelados / Encerrados / RecParciais / FatParciais | os 7 = "T" | ⚠️ | sem dados: Client-5113 |
| list_purchase_orders | dDataInicial / dDataFinal | 01/01/2020–31/12/2026 | ⚠️ | sem dados: Client-5113. Parei no 3º erro seguido |
| list_purchase_orders | lApenasImportadoApi, lApenasAlterados | não enviados | ⚠️ | sem dados (parei nos erros) |
| get_purchase_order | cNumero | "1" | ⚠️ | sem dados: Client-206 "Pedido de compra não cadastrado para o Número [000000000000001]" (chega à Omie, completado com zeros) |
| get_purchase_order | nCodPed, cCodIntPed | não enviados | ⚠️ | sem dados |

### Serviços e NFS-e

| Tool | Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|---|
| list_service_orders | pagina | status "N", pagina=2 | ✅ | 5963738552 (p. 1: 5963175100) |
| list_service_orders | registros_por_pagina | reg=1 | ✅ | 17 |
| list_service_orders | filtrar_por_etapa | "60" | ✅ | 15 |
| list_service_orders | filtrar_por_status | "N" | ✅ | 2 |
| list_service_orders | filtrar_por_cliente | 5961454237 | ✅ | 2 |
| list_service_orders | filtrar_por_data_de / _ate | 11/09–11/09 | ✅ | 3 |
| list_service_orders | filtrar_por_data_previsao_de / _ate | 01/10–31/10 | ✅ | 1 (5963175100) |
| list_service_orders | filtrar_por_data_faturamento_de / _ate | 03/09–03/09 | ✅ | 3 |
| list_service_orders | cExibirProdutos | "S" | ⚠️ | sem dados: nenhuma OS usa produtos |
| list_service_orders | cExibirDespesas | "S" | ⚠️ | sem dados: nenhuma OS tem despesas |
| get_service_order | cNumOS | "20" | ✅ | nCodOS 5963175100 |
| get_service_order | nCodOS | 5961458730 | ✅ | cNumOS 16 |
| get_service_order | cCodIntOS | código inexistente | ✅ | Client-103 "OS não cadastrada para o Código de Integração": chega à Omie (nenhuma OS tem código) |
| validate_service_order | nCodOS | 5963175100 (etapa 20) | ✅ | cCodStatus 1 "Para emitir falta preencher o E-mail." |
| validate_service_order | cCodIntOS | código inexistente | ✅ | Client-103: chega à Omie |
| list_services | nPagina | nPagina=2, reg=1 | ✅ | nCodServ 5958829722 (p. 1: 5956687642) |
| list_services | nRegPorPagina | 1 | ✅ | 7 |
| list_services | (resposta) | — | ⚠️ | o ID vem em intListar.nCodServ. **Corrigido** na descrição |
| list_services | cOrdenarPor | "DESCRICAO"; "CODIGO" + desc | ❌ | primeiro sempre 5956687642. **Documentado** |
| list_services | cOrdemDecrescente | "S" | ❌ | primeiro inalterado. **Documentado** |
| list_services | cDescricao | "VISITA"; "TÉCNICA"; "%TÉCNICA%" | ⚠️ | 1; Client-5113 (0); 3: casa o começo, `%` funciona. **Corrigido** na descrição |
| list_services | cCodigo | "SRV00006" | ✅ | 1 (5961260851) |
| list_services | inativo | "S"; "N" + inclusão | ✅ | 0; 3 |
| list_services | dInclusaoInicial / dInclusaoFinal | 30/08–27/09 | ✅ | 3 |
| list_services | dAlteracaoInicial / dAlteracaoFinal | 05/09–27/09 | ✅ | 1 (SRV00007) |
| list_nfse | nPagina | status "F", nPagina=2 | ✅ | nPagina 2 de 14 |
| list_nfse | nRegPorPagina | 1 | ✅ | 15 |
| list_nfse | dEmiInicial / dEmiFinal | 01/09–03/09 | ✅ | 4 |
| list_nfse | nNumeroNFSe | "1057" | ✅ | 1 (5961789324) |
| list_nfse | nCodigoCliente | 5961454237 | ✅ | 2 |
| list_nfse | nCodigoOS | 5961458730; 5963738552 (não faturada) | ✅ | 1; 0 |
| list_nfse | cStatusNFSe | "C" | ✅ | 1 (5961852858) |
| list_nfse | cExibirDescricao | "S" | ✅ | ListaServicos[0].cDescricao presente (ausente sem) |

### Financeiro

| Tool | Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|---|
| get_financial | pagina | ATRASADO, pagina=2 | ✅ | 5965615250 (p. 1: 5962783931) |
| get_financial | registros_por_pagina | reg=1 | ✅ | 64 |
| get_financial | filtrar_por_emissao_de / _ate | 03/09–03/09 | ✅ | 8 |
| get_financial | filtrar_por_data_de / _ate | 20/09–27/09 | ✅ | 13 (aqui sem flag) |
| get_financial | filtrar_por_status | "ATRASADO"; "AVENCER" | ⚠️ | 2; 23 ✅, mas as linhas escrevem "A VENCER" com espaço. **Corrigido** na descrição |
| get_financial | filtrar_apenas_titulos_em_aberto | "S" | ✅ | 25 (= 23 + 2) |
| get_financial | filtrar_cliente | 5961454237 | ✅ | 2 |
| get_financial | filtrar_por_cpf_cnpj | `<só dígitos>` | ✅ | 2 |
| get_financial | filtrar_conta_corrente | 5952605177 | ✅ | 60 de 64 |
| get_financial | filtrar_por_projeto | 123456 | ✅ | 0: aplicado |
| get_financial | exibir_obs | "S" | ✅ | `observacao` presente em 5962772133, ausente sem |
| get_account_receivable | codigo_lancamento_omie | 5965615250 | ✅ | ATRASADO, boleto gerado |
| get_account_receivable | codigo_lancamento_integracao | "542119272942456" | ✅ | codigo_lancamento_omie 5961289060 |
| list_accounts_payable | pagina | `<CNPJ>`, pagina=2 | ✅ | pagina 2 de 5 (5967433604) |
| list_accounts_payable | registros_por_pagina | reg=1 | ✅ | 29 |
| list_accounts_payable | filtrar_por_status | AVENCER; PAGO; CANCELADO; LIQUIDADO | ⚠️ | 21; 7; 3; 8. PAGO e LIQUIDADO incluem 1598355680, que está CANCELADO (21 + 7 + 3 > 29). **Documentado** na descrição |
| list_accounts_payable | filtrar_por_emissao_de / _ate | 10/09–10/09 | ✅ | 4 |
| list_accounts_payable | filtrar_por_data_de / _ate | 20/09–27/09 | ✅ | 6 |
| list_accounts_payable | filtrar_cliente | 5957479785 | ✅ | 5 |
| list_accounts_payable | filtrar_por_cpf_cnpj | `<só dígitos>` | ✅ | 5 |
| list_accounts_payable | filtrar_conta_corrente | 5955418052 | ✅ | 0: aplicado |
| list_accounts_payable | filtrar_por_projeto | 123456 | ✅ | Client-1035 "Projeto não cadastrado": validado pela Omie |
| list_accounts_payable | exibir_obs | "S" | ✅ | `observacao` em 5967433601, ausente sem |
| get_account_payable | codigo_lancamento_omie | 5967433604 | ✅ | A VENCER, 842,50 |
| get_account_payable | codigo_lancamento_integracao | código inexistente | ✅ | Client-103: chega à Omie (nenhum título tem código) |
| list_cash_entries | (descrição, 0.8.2) | reg=1 | ❌ | dizia que as baixas não estão aqui: 1ª linha 5953235548 é BAXP (nCodLancCP 1598714877); 14 de 21 são baixas. **Corrigido** (0.9.0 + cOrigem nesta PR) |
| list_cash_entries | nPagina | dDtInc 12/08, nPagina=2 | ✅ | 0 (a janela tem 1 registro) |
| list_cash_entries | nRegPorPagina | 1; 5 | ✅ | 21 páginas; 1 linha |
| list_cash_entries | dtPagInicial / dtPagFinal | 09/09–09/09 | ✅ | 1 (5964359132) |
| list_cash_entries | dDtIncDe / dDtIncAte | 12/08–12/08 | ✅ | 1 de 21 (5953235548); antes, 2 × Client-1880 |
| list_cash_entries | cOrigem | "BAXP"; "BAXR" | ⚠️ | 7; 7 (5964359132 → nCodLancCR 5964354918). Códigos fora da doc. **Corrigido**: a descrição os lista |
| list_financial_movements | (descrição) | `{}` | ❌ | "sem filtro de data, só 30 dias": 127 linhas, a 1ª (1598355680) emitida 04/08 e paga 10/08. **Corrigido** |
| list_financial_movements | nPagina | `<CNPJ>`, nPagina=2 | ✅ | pagina 2 de 3 |
| list_financial_movements | nRegPorPagina | 1 | ✅ | 127 |
| list_financial_movements | dDtVencDe / dDtVencAte | 29/09–30/09 | ✅ | 5 |
| list_financial_movements | dDtPagtoDe / dDtPagtoAte | 09/09–09/09 | ✅ | 2 |
| list_financial_movements | dDtEmisDe / dDtEmisAte | 01/01/2020–31/12/2030 | ✅ | 117 (< 127: exclui as linhas sem emissão) |
| list_financial_movements | cNatureza | "P" | ✅ | 43 |
| list_financial_movements | cStatus | R + "ATRASADO"; P + "AVENCER" | ✅ | 2 (servidor envia CR; fato conhecido); 21 (= list_accounts_payable) |
| list_financial_movements | cTpLancamento | R + "BXCR"; "CC" | ✅ | 7 baixas com nCodBaixa 5964359133 e nCodMovCC 5964359132; 21 (= list_cash_entries) |
| list_financial_movements | nCodCliente | 5963757368 | ✅ | 3 |
| list_financial_movements | cCPFCNPJCliente | `<CNPJ formatado>` | ✅ | 3 |
| list_financial_movements | nCodCC | 5950680165 | ✅ | 3 |
| list_financial_movements | cCodCateg | "2.01.04" | ✅ | 9 |
| list_financial_movements | cExibirDepartamentos | "S" | ⚠️ | sem dados: nenhum rateio por departamento |
| get_bank_statement | (descrição) | — | ⚠️ | dizia "como conciliado na Omie"; as linhas vêm "Não conciliado" também. **Corrigido** |
| get_bank_statement | nCodCC | 5952605177, 08/09–10/09 | ✅ | saldo anterior e atual; 8 linhas (4 lançamentos + SALDO) |
| get_bank_statement | (sem nCodCC nem cCodIntCC) | só o período | ❌ | HTTP 500 Client-1002 "O preenchimento das tags [nCodCC] ou [cCodIntCC] é obrigatório!". **Corrigido**: anyOfRequired |
| get_bank_statement | cCodIntCC | código inexistente | ✅ | Client-832: chega à Omie (nenhuma conta tem código) |
| get_bank_statement | dPeriodoInicial / dPeriodoFinal | 09/09–09/09 | ✅ | 1 lançamento (5964359132) |
| get_bank_statement | cExibirApenasSaldo | "S" | ✅ | mesmos saldos, listaMovimentos [] |
| get_finance_summary | (sem argumentos) | `{}` | ❌ | HTTP 500 Client-71 "Nenhum parâmetro foi recebido em WS_PARAMS!". **Corrigido**: lApenasResumo=true por padrão |
| get_finance_summary | lApenasResumo | true; false | ✅ | resumo + fluxo de 10 dias; false acrescenta contaReceberAtraso [1] (5965615250) e contaPagarAtraso [] |
| get_finance_summary | lExibirCategoria | true com resumo true; true com resumo false | ⚠️ | null; contaReceberCategoria [2] (1.01.01, 1.01.02). **Corrigido** na descrição |
| get_finance_summary | dDia | "25/09/2026" | ⚠️ | fluxoCaixa começa em 25/09; saldos e totais não mudam. **Corrigido** na descrição |
| list_open_titles | cTipo | "R" (hoje, domingo); "P" + 29/09 | ✅ | 5962783931 venc. 25/09, nDiasAtraso 0 (fato conhecido); 5967439767 |
| list_open_titles | dDia | 15/09; 05/10 | ✅ | 5965615250; 2 títulos |
| list_open_titles | nPagina | reg=1, nPagina=2 | ✅ | 5962527896 |
| list_open_titles | nRegPorPagina | 2 | ✅ | 2 |
| list_open_titles | nCodCliente | 5960133574 | ✅ | 1 (5962527896) |
| list_open_titles | cNomeCliente | `<trecho do nome>` | ✅ | 1 (5965959499) |
| list_open_titles | (resposta) | — | ✅ | sem cUrlLogoBanco |

### Cobrança

| Tool | Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|---|
| get_pix_qrcode | nIdConta | 5952605177 (uma única chamada) | ⚠️ | HTTP 200 cCodStatus "719": só conta Omie.CASH tem QR estático (a desta conta, 5950680322, está inativa). **Corrigido** na descrição |
| get_pix_status | nCodTitulo | 5962783931 | ⚠️ | sem dados: Client-5113 "Registro não encontrado!" (chega à Omie; nenhum PIX na conta) |
| get_pix_status | nIdPix, cCodIntPix | não enviados | ⚠️ | sem dados |
| list_pix | nRegPorPagina | 2 | ⚠️ | sem dados: Client-5113 |
| list_pix | dEmissaoDe / dEmissaoAte | 01/01–31/12/2026 | ⚠️ | sem dados: Client-5113. Parei no 2º erro |
| list_pix | nPagina, cStatus | não enviados | ⚠️ | sem dados |
| get_boleto | nCodTitulo | 5962783931 | ⚠️ | ✅ cCodStatus "0", cLinkBoleto, cNumBoleto, cCodBarras; mas diz "Boleto gerado com sucesso!" numa leitura. **Corrigido** na descrição |
| get_boleto | cCodIntTitulo | código inexistente | ⚠️ | HTTP 200 com cCodStatus "103": o erro vem dentro do 200. **Corrigido** na descrição |

### Estoque

| Tool | Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|---|
| list_stock_adjustments | pagina | pagina=2, reg=1 | ✅ | 0 (a conta tem 1 ajuste, 5961732978) |
| list_stock_adjustments | registros_por_pagina | 1; 3 | ✅ | 1 |
| list_stock_adjustments | ordenar_por | "DATA_MOVIMENTO"; "PRODUTO" | ⚠️ | sem dados: 1 registro |
| list_stock_adjustments | id_prod | 5955136372; 5955136584 | ✅ | 0; 1 |
| list_stock_adjustments | cod_int_ajuste | código inexistente | ✅ | 0 |
| list_stock_adjustments | codigo_local_estoque | 5950680196 + tipo SLD | ⚠️ | sem dados: 1 (a conta tem um único local) |
| list_stock_adjustments | tipo | "ENT"; "SLD" | ✅ | 0; 1 |
| list_stock_adjustments | origem | "PDV"; "AJU" | ✅ | 0; 1 |
| list_stock_adjustments | motivo | "PER"; "INV" | ✅ | 0; 1 |
| list_stock_adjustments | data_movimento_de / _ate | 01/09–27/09; 01/08–31/08 | ✅ | 0; 1 |
| list_stock_adjustments | apenas_importado_api | "S"; "N" | ✅ | 0; 1 |
| get_stock_position | (descrição) | dDataPosicao 20/08 | ❌ | dizia que saldo zero fica de fora: 5955136584 veio com saldo 0. cExibeTodos é "sem movimento" (doc). **Corrigido** |
| get_stock_position | nPagina | local + nPagina=2 | ✅ | pagina 2 de 47 |
| get_stock_position | nRegPorPagina | 2; 1 com cExibeTodos | ❌ | 2 ✅; com cExibeTodos "S" vieram 50 (nTotPaginas 5). **Documentado** |
| get_stock_position | dDataPosicao | 20/08 | ✅ | 1 linha (hoje: 47) |
| get_stock_position | cExibeTodos | "S" | ✅ | 213 (de 47) |
| get_stock_position | codigo_local_estoque | 5950680196 + cTipoItem 99 | ✅ | 25 (local único; com nPagina=2 → 2/47) |
| get_stock_position | lista_local_estoque | "123456" | ✅ | Client-1070 "Local do Estoque não cadastrado": validado |
| get_stock_position | cTipoItem | "99" | ✅ | 25 de 47 |
| get_product_stock | id_prod | 5955136372 | ✅ | saldo 4, físico 4, cmc 100 |
| get_product_stock | cod_int | "2000000000018" | ✅ | saldo 4 (mesmo produto) |
| get_product_stock | data | 20/08 + local | ✅ | saldo 0 |
| get_product_stock | codigo_local_estoque | 123456 | ✅ | Client-1070: validado |
| list_stock_movements | nPagina | lista_local, nPagina=2 | ✅ | pagina 2 de 63 |
| list_stock_movements | nRegPorPagina | 1 | ✅ | 63 |
| list_stock_movements | codigo_local_estoque | 123456; + lista_local_estoque | ⚠️ | Client-1070 ✅; os dois juntos → Client-1073 "Preencha apenas…". **Corrigido** na descrição |
| list_stock_movements | idProd | 5955136372 | ✅ | 2 |
| list_stock_movements | dDtInicial / dDtFinal | 24/09–24/09; 01/08; 15/07; 14/09; 01/01 (até 27/09) | ❌ | 3 ✅; 63; **42**; 21; **0**: a Omie corta cerca de 60 dias a partir de dDtInicial. **Documentado** |
| list_stock_movements | lista_local_estoque | 5950680196 | ✅ | 63 |
| list_stock_locations | nPagina | nPagina=2, reg=1 | ✅ | "Não existem registros para a página [2]" |
| list_stock_locations | nRegPorPagina | 1 | ✅ | 1 (codigo_local_estoque 5950680196) |
| list_stock_locations | filtrar_por_data_de | 04/09 | ✅ | 0 (alterado em 03/09) |
| list_stock_locations | filtrar_por_data_ate | 01/09–05/09 | ✅ | 1 |
| list_stock_locations | filtrar_apenas_inclusao | janela + "S" | ✅ | 0 (incluído em 04/08) |
| list_stock_locations | filtrar_apenas_alteracao | janela + "S" | ✅ | 1 |
| list_stock_locations | (resposta / demo) | — | ❌ | a chave é `locaisEncontrados`; o modo demo dizia `locais`. **Corrigido** |

### Cadastros

| Tool | Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|---|
| get_company_info | pagina | pagina=2, reg=1 | ⚠️ | sem dados: 1 empresa (5950680145); a Omie devolve a página 1 |
| get_company_info | registros_por_pagina | 1 | ✅ | 1 |
| get_bank_accounts | pagina | ativo "S", reg=1, pagina=2 | ✅ | 5952605177 |
| get_bank_accounts | registros_por_pagina | 1 | ✅ | 6 páginas |
| get_bank_accounts | filtrar_por_data_de | 15/09 | ✅ | 3 de 7 |
| get_bank_accounts | filtrar_por_data_ate | 10/09 sozinho; 01/08–10/09 | ⚠️ | Client-101 "Nenhuma conta corrente foi encontrada!"; 5 ✅ |
| get_bank_accounts | filtrar_apenas_inclusao | de 15/09 + "S" | ✅ | 1 (5971459483) |
| get_bank_accounts | filtrar_apenas_alteracao | de 15/09 + "S" | ⚠️ | 3 = sem flag. **Corrigido** na descrição |
| get_bank_accounts | codigo | 5952605177 | ✅ | 1 |
| get_bank_accounts | codigo_integracao | código inexistente | ✅ | Client-101: aplicado |
| get_bank_accounts | filtrar_por_descricao | `<nome do banco>` | ✅ | 1 (5955418052) |
| get_bank_accounts | filtrar_apenas_ativo | "S" | ✅ | 6 de 7 (5950680322 inativa) |
| list_categories | pagina | pagina=2, reg=1 | ✅ | 0.01.01 (p. 1: 0.01) |
| list_categories | registros_por_pagina | 1 | ✅ | 142 |
| list_categories | descricao | `<nome exato>`; "Compras"; "Mercadoria" | ✅ | 1 (2.01.01); 3; 6 (contém) |
| list_categories | filtrar_por_tipo | "R"; "D" | ✅ | 14; 59 |
| list_categories | filtrar_apenas_ativo | "S" | ✅ | 73 (= 14 + 59) |
| list_departments | pagina | pagina=2, reg=1 | ✅ | 0 (p. 1: 5950680163) |
| list_departments | registros_por_pagina | 1 | ✅ | 1 |
| list_projects | pagina, registros_por_pagina, filtrar_por_data_de / _ate, filtrar_apenas_inclusao / _alteracao, ordenar_por, ordem_descrescente, nome_projeto, apenas_importado_api | os 10 juntos | ⚠️ | sem dados: 0 projetos, sem erro |
| list_dre | apenasContasAtivas | padrão do servidor "S"; "N" | ✅ | 27; 28 (+1.21.01) |
| list_payment_terms | pagina | pagina=2, reg=5 | ✅ | pagina 2 de 8: 005, 006, 3R4, 631, 999 |
| list_payment_terms | registros_por_pagina | 5; 36 | ✅ | 36 no total |
| list_payment_terms | ordenar_por | "DESCRICAO" | ✅ | "1 Parcela", "2 Parcelas", "28/56" |
| list_payment_terms | ordem_decrescente | "S" | ✅ | primeiro T54 |
| list_payment_terms | apenas_importado_api | "S" | ❌ | 36 = sem filtro. **Documentado** na descrição |
| list_payment_terms | (resposta / demo) | reg=36 | ❌ | 000/001/999 como no fato conhecido ✅; a chave é `cadastros`, e o modo demo dizia `parcela_cadastro` com 999 = "A vista". **Corrigido** |
| list_salespeople | pagina | pagina=2, reg=1 | ✅ | 0 (total_de_registros 0 além do fim) |
| list_salespeople | registros_por_pagina | 1 | ✅ | 1 (codigo 5961789333) |
| list_salespeople | (resposta) | — | ⚠️ | o ID é `codigo` (codVend / nCodVend nas outras tools). **Corrigido** na descrição |
| list_salespeople | filtrar_por_data_de | 26/09 | ✅ | 0 |
| list_salespeople | filtrar_por_data_ate | 01/08–26/09 | ✅ | 1 |
| list_salespeople | filtrar_apenas_inclusao | janela + "S" | ✅ | 1 |
| list_salespeople | filtrar_apenas_alteracao | janela + "S" | ⚠️ | sem dados: 1 vendedor |
| list_salespeople | ordenar_por, ordem_descrescente | "CODIGO" + "S" | ⚠️ | sem dados: 1 vendedor |
| list_salespeople | filtrar_por_nome | nome inexistente; `<trecho do nome>` | ✅ | 0; 1 (contém) |
| list_salespeople | filtrar_por_email | e-mail inexistente | ✅ | 0 (sem o filtro: 1) |

### Contagem

A contagem é por propriedade. Numa linha que agrupa várias, cada propriedade
herda o resultado da linha. As linhas "(descrição)" e "(resposta)" ficam fora
da contagem.

<!-- count:begin -->
| Tool | Propriedades | ✅ | ⚠️ | ❌ |
|---|---:|---:|---:|---:|
| list_customers | 3 | 2 | 0 | 1 |
| get_customer | 2 | 2 | 0 | 0 |
| list_customers_summary | 12 | 8 | 1 | 3 |
| list_products | 13 | 10 | 2 | 1 |
| get_product | 3 | 3 | 0 | 0 |
| list_orders | 21 | 17 | 4 | 0 |
| get_sales_order | 2 | 2 | 0 | 0 |
| get_order_status | 2 | 2 | 0 | 0 |
| simulate_order_taxes | 13 | 13 | 0 | 0 |
| validate_order | 2 | 2 | 0 | 0 |
| list_order_stages | 9 | 9 | 0 | 0 |
| list_invoices | 27 | 22 | 3 | 2 |
| create_invoice | 8 | 6 | 2 | 0 |
| get_invoice_pdf | 1 | 0 | 1 | 0 |
| list_purchase_orders | 13 | 0 | 13 | 0 |
| get_purchase_order | 3 | 0 | 3 | 0 |
| list_service_orders | 13 | 11 | 2 | 0 |
| get_service_order | 3 | 3 | 0 | 0 |
| validate_service_order | 2 | 2 | 0 | 0 |
| list_services | 11 | 8 | 1 | 2 |
| list_nfse | 9 | 9 | 0 | 0 |
| get_financial | 13 | 12 | 1 | 0 |
| get_account_receivable | 2 | 2 | 0 | 0 |
| list_accounts_payable | 12 | 11 | 1 | 0 |
| get_account_payable | 2 | 2 | 0 | 0 |
| list_cash_entries | 7 | 6 | 1 | 0 |
| list_financial_movements | 16 | 15 | 1 | 0 |
| get_bank_statement | 5 | 5 | 0 | 0 |
| get_finance_summary | 3 | 1 | 2 | 0 |
| list_open_titles | 6 | 6 | 0 | 0 |
| get_pix_qrcode | 1 | 0 | 1 | 0 |
| get_pix_status | 3 | 0 | 3 | 0 |
| list_pix | 5 | 0 | 5 | 0 |
| get_boleto | 2 | 0 | 2 | 0 |
| list_stock_adjustments | 12 | 10 | 2 | 0 |
| get_stock_position | 7 | 6 | 0 | 1 |
| get_product_stock | 4 | 4 | 0 | 0 |
| list_stock_movements | 7 | 4 | 1 | 2 |
| list_stock_locations | 6 | 6 | 0 | 0 |
| get_company_info | 2 | 1 | 1 | 0 |
| get_bank_accounts | 10 | 8 | 2 | 0 |
| list_categories | 5 | 5 | 0 | 0 |
| list_departments | 2 | 2 | 0 | 0 |
| list_projects | 10 | 0 | 10 | 0 |
| list_dre | 1 | 1 | 0 | 0 |
| list_payment_terms | 5 | 4 | 0 | 1 |
| list_salespeople | 10 | 7 | 3 | 0 |
| **Total** | **330** | **249** | **68** | **13** |
<!-- count:end -->

## 0.9.2 — `get_service_order_status`

_Data: 2026-10-03 (07h56–07h57 UTC). Servidor em produção no conector:
`mcp-omie` 0.9.2 (deploy run 37107591696, 07h55 UTC). As correções desta
seção saem na **0.9.3**._

Origem: em 02/10/2026 três OS faturadas tiveram o RPS rejeitado pela
prefeitura de Ribeirão Preto (`cStatusRps` `003`). `list_nfse` e
`get_service_order` não mostram o motivo. O `StatusOS`, chamado à mão fora do
MCP, devolveu os erros EM076, E0314 e EM062.

### Como foi feito

- **Só leitura.** Foram 11 chamadas, uma de cada vez, pelo conector Omie da
  sessão: 10 a `get_service_order_status` e 1 a `list_nfse`. Nenhuma tool de
  escrita foi chamada. O único erro foi o Client-103 esperado em `cCodIntOS`.
  Não houve REDUNDANT.
- **Sem dados pessoais.** Aparecem só IDs da Omie, números de OS, RPS, lote e
  NFS-e, e os códigos e textos de erro da prefeitura, que são genéricos. CNPJ,
  inscrição municipal, nome do cliente, código de verificação e links ficam
  fora daqui e foram anonimizados nas fixtures.

### OS do plano

| nCodOS | OS / RPS | Argumentos | Resultado | Evidência |
|---|---|---|---|---|
| 5975011809 | OS 38, RPS 17 | `lMsg` true | ✅ | `cStatusLote` / `cStatusRps` 003, lote 5975141787. Cinco tentativas em 02/10 (14:23, 14:39, 17:07, 17:30, 18:08), cada uma com EM076, EM062 e E0314, menos a das 17:30, que trouxe só EM076 e E0314. 24 mensagens. |
| 5975012350 | OS 40, RPS 18 | `lMsg` true | ✅ | 003, lote 5975217128. Uma tentativa (16:35) com EM076, EM062 e E0314. |
| 5963738552 | OS 23, RPS 19 | `lMsg` true | ✅ | 003, lote 5975278566. Uma tentativa (19:29) com EM076 e E0314. |
| 5973717027 | OS 36, RPS 15 | — | ✅ | 004, lote 5973732546, `nNfse` 1071, `cCodVerif` preenchido, `mensagens` vazio, `cUrlNfse` presente. |

Nenhuma das três rejeitadas tinha sido reenviada depois de 02/10.

### Propriedades

| Propriedade | Argumentos usados | Resultado | Evidência |
|---|---|---|---|
| nCodOS | as quatro OS acima | ✅ | `cNumOS` 38, 40, 23 e 36 |
| cCodIntOS | código inexistente | ✅ | Client-103 "OS não cadastrada para o Código de Integração": chega à Omie (nenhuma OS tem código) |
| lMsg | 5975011809 com `true` e sem o campo | ⚠️ | com: o histórico, ver abaixo. Sem: as 14 linhas de ERRO das cinco tentativas, **da mais antiga para a mais recente** (o inverso exato da ordem com `lMsg`), só com `cCodigo`, `cCorrecao` e `cDescricao`, sem `cSituacao`, data ou hora. Não dá para saber quais erros são da última tentativa. **Corrigido** na descrição (0.9.3) |
| lPdfDemo | 5973717027 | ✅ | `cUrlPdfDemo` aparece, um link S3 pré-assinado com prazo. Sem a flag, a chave não vem |
| lPdfDest | 5973717027 | ✅ | `cUrlPdfDest` aparece, também pré-assinado. Sem a flag, a chave não vem |
| lRps | 5973717027 | ⚠️ | a chave `cUrlRps` aparece, mas vazia. Sem a flag, ela não vem. A flag chega à Omie; esta NFS-e não tem link de RPS. Registrado na descrição |
| lPdfRecibo | 5973717027 | ⚠️ | sem dados: `cUrlPdfRecibo` vem vazio com e sem a flag; a OS não tem recibo (`cNumRecibo` "0") |
| (resposta) xml_distr | as quatro OS | ⚠️ | ausente do resultado. Não dá para saber pelo conector se a Omie mandou o campo e a tool tirou, ou se ele nem veio: o log de auditoria guarda só um resumo. A remoção fica provada pelo teste |
| (resposta) cInscrMunicipal | as quatro OS | ⚠️ | vem como string de 8 dígitos; a doc diz `integer`. Só registrado |
| (resposta) danfe | 5973717027 | ⚠️ | igual a `cUrlNfse`, o link da nota na prefeitura, não um DANFE. Registrado na descrição |

Com `lMsg=true`, cada tentativa vem como um bloco, e dentro do bloco também a
mais recente vem primeiro: as linhas de ERRO, depois "Envio do RPS 17 retornou
erros." e, por último, "Enviando o RPS 17 no Lote 5975141787 para a prefeitura
da sua cidade.". As duas linhas informativas têm `cSituacao` vazio. `cAnexo` é
"S" nas de ERRO e em "retornou erros", e "N" em "Enviando". `cUsuario` é
"Integração" em todas.

### `list_nfse` na mesma OS

| Tool | Argumentos usados | Resultado | Evidência |
|---|---|---|---|
| list_nfse | `nCodigoOS` 5975011809 | ✅ | `Cabecalho.cStatusNFSe` "R", fora dos valores da doc (C/F/N), com `RPS.cStatusRPS` "003" e nenhuma mensagem. Confirma o que a descrição da 0.9.2 diz |

### Testes

As respostas montadas em `read-tools.test.ts` foram trocadas por três
fixtures anonimizadas desta rodada, em `src/__tests__/fixtures/live/`:

- `get_service_order_status.rejected-history.json`: a OS 38 com `lMsg`, nos
  cinco blocos;
- `get_service_order_status.errors-only.json`: a OS 38 sem `lMsg`, com a ordem
  invertida;
- `get_service_order_status.issued.json`: a OS 36 com `lPdfDemo`.

As capturas passaram pelo conector, depois do `transform`. Por isso o teste da
OS 36 recoloca um `xml_distr` antes de mostrar que a tool o remove. O teste de
fixtures agora aceita qualquer data de captura no `_comment`.
