# Auditoria das tools do MCP Omie × documentação oficial da API

_Data: 2026-08-12 — versão auditada: `mcp-omie` 0.2.2 (30 tools, `src/index.ts`)._

> **Status:** as 7 tools da seção 1 foram corrigidas em **0.2.3** — schemas
> reescritos conforme o contrato documentado, mais validação de argumentos
> antes do envio e teste de contrato cobrindo as 30 tools. As seções 2, 4 e 5
> continuam abertas.

Fonte da verdade: as páginas de referência publicadas pela Omie em
`https://app.omie.com.br/api/v1/<recurso>/` (lista em
[developer.omie.com.br/service-list](https://developer.omie.com.br/service-list/)),
que trazem, por endpoint, os métodos existentes, o exemplo de payload e a
definição de cada tipo complexo com nome e tipo de todos os campos aceitos.
Cada afirmação abaixo foi conferida contra essa referência, endpoint por
endpoint.

---

## Sumário executivo

| Situação | Tools | |
|---|---|---|
| ❌ **Quebradas** — método inexistente ou payload incompatível | 7 | ✔ corrigidas em 0.2.3 |
| ⚠️ Chamada correta, **parâmetro inválido** (filtro ignorado ou erro) | 7 | aberto |
| ✅ Conformes (ajustes opcionais) | 16 | — |
| 🏷️ Nome enganoso — o agente escolhe a tool errada | 3 (sobrepõe as linhas acima) | aberto |

**7 das 30 tools não conseguem funcionar em produção.** Duas delas
(`create_purchase_order`, `list_purchase_orders`) chamam métodos que
simplesmente não existem na API. As outras cinco montam o `param` com uma
estrutura que a Omie não reconhece.

Outras 7 aceitam filtros que não existem no contrato — o pior caso de falha
silenciosa: a chamada retorna 200 e o agente entrega ao usuário um resultado
sem o filtro pedido (por exemplo, "contas a pagar vencendo esta semana"
devolvendo a carteira inteira).

O ponto cego que permitiu tudo isso: a suíte de testes tem 53 linhas e
verifica a contagem de tools e **um** endpoint. Nenhum teste confere nome de
método ou forma do `param` — exatamente onde estão todos os defeitos.

---

## 1. Tools quebradas (P0) — corrigidas em 0.2.3

O diagnóstico abaixo descreve o estado em 0.2.2. Cada item foi corrigido
substituindo o schema pelo contrato documentado; o teste de contrato em
`src/__tests__/index.test.ts` fixa `(path, call)` das 30 tools e a forma do
`param` das sete reescritas.

### 1.1 `create_purchase_order` — método inexistente

`src/index.ts:620` chama `IncluirPedidoCompra` em `/produtos/pedidocompra/`.
Esse método **não existe**. Os métodos publicados no endpoint são:
`IncluirPedCompra`, `AlteraPedCompra`, `ConsultarPedCompra`,
`ExcluirPedCompra`, `PesquisarPedCompra`, `UpsertPedCompra`.

O payload também não tem relação com o schema exposto
(`src/index.ts:302-316`). O contrato real de `IncluirPedCompra` é:

```jsonc
{
  "cabecalho_incluir": {
    "cCodIntPed": "INT001",     // ~ codigo_pedido_integracao
    "dDtPrevisao": "06/01/2027", // ~ data_previsao
    "nCodFor": 14170458,         // ~ codigo_fornecedor
    "cCodCateg": "", "nCodCC": 1208238, "nQtdeParc": 1,
    "cNumPedido": "25337", "cObs": "", "cObsInt": ""
  },
  "frete_incluir": { "cTpFrete": "9", "nValFrete": 0, ... },
  "departamentos_incluir": [ { "cCodDepto": "...", "nPerc": 50 } ],
  "produtos_incluir": [
    { "cCodIntItem": "ITEM001", "nCodProd": 2037060,
      "nQtde": 10, "nValUnit": 200, "nDesconto": 0, ... }
  ]
}
```

Nenhum dos nomes usados hoje (`codigo_fornecedor`, `itens`, `observacoes`)
existe. Correção = reescrever a tool inteira.

### 1.2 `list_purchase_orders` — método inexistente

`src/index.ts:622` chama `ListarPedidosCompra`; o método real é
`PesquisarPedCompra`, com uma assinatura completamente diferente — inclusive
a paginação:

```jsonc
{ "nPagina": 1, "nRegsPorPagina": 10,        // não é pagina/registros_por_pagina
  "lApenasImportadoApi": "F",
  "lExibirPedidosPendentes": "T", "lExibirPedidosFaturados": "F",
  "lExibirPedidosRecebidos": "F", "lExibirPedidosCancelados": "F",
  "lExibirPedidosEncerrados": "F", "lExibirPedidosRecParciais": "F",
  "lExibirPedidosFatParciais": "F",
  "dDataInicial": "01/01/2021", "dDataFinal": "31/12/2021" }
```

Não existe `etapa` aqui: o estágio é selecionado pelos flags `lExibirPedidos*`
(strings `"T"`/`"F"`). O schema atual (`src/index.ts:317-328`) precisa ser
substituído.

### 1.3 `create_order` — payload plano contra API aninhada

`IncluirPedido` existe, mas `src/index.ts:582` repassa `args` cru como
`param[0]`, e o schema (`src/index.ts:200-214`) declara `codigo_cliente`,
`codigo_pedido_integracao`, `data_previsao` e `itens` na raiz. O contrato real
é aninhado em quatro blocos:

```jsonc
{
  "cabecalho": { "codigo_cliente": 3792227, "codigo_pedido_integracao": "...",
                 "data_previsao": "12/08/2026", "etapa": "10",
                 "codigo_parcela": "999", "quantidade_itens": 2 },
  "det": [ { "ide": { "codigo_item_integracao": "4422421" },
             "produto": { "codigo_produto": 4422421, "quantidade": 1,
                          "valor_unitario": 200, "cfop": "5.102",
                          "ncm": "...", "unidade": "UN" } } ],
  "informacoes_adicionais": { "codigo_categoria": "1.01.03",
                              "codigo_conta_corrente": 11850365,
                              "consumidor_final": "S" },
  "frete": { "modalidade": "9" },
  "lista_parcelas": { "parcela": [ ... ] }
}
```

Obrigatórios que o schema atual nem menciona e sem os quais a inclusão falha:
`cabecalho.etapa`, `cabecalho.codigo_parcela`,
`informacoes_adicionais.codigo_categoria` e
`informacoes_adicionais.codigo_conta_corrente`. O array de itens chama-se
`det` (não `itens`) e cada item é `{ide, produto, imposto?, inf_adic?}` —
o preço vai em `det[].produto.valor_unitario`, não na raiz do item.

### 1.4 `create_service_order` — payload plano contra API PascalCase

`IncluirOS` existe (`/servicos/os/`), mas o corpo real usa outra convenção de
nomes e outra estrutura que o schema de `src/index.ts:275-289`:

```jsonc
{
  "Cabecalho": { "cCodIntOS": "...", "nCodCli": 2485994,
                 "dDtPrevisao": "12/08/2026", "cEtapa": "20",
                 "cCodParc": "999", "nQtdeParc": 7 },
  "InformacoesAdicionais": { "cCodCateg": "1.01.02", "nCodCC": 11850365 },
  "ServicosPrestados": [ { "nCodServico": 2342423, "nQtde": 3,
                           "nValUnit": 1000, "cTribServ": "01",
                           "cCodServLC116": "7.07", "cRetemISS": "N",
                           "impostos": { ... } } ],
  "Departamentos": [], "Email": { ... }, "Observacoes": { ... }
}
```

`codigo_cliente`, `codigo_pedido_integracao`, `data_previsao`, `servicos` e
`observacoes` não existem no contrato. Note que `cCodCateg` e `nCodCC` são
obrigatórios na prática (categoria e conta corrente do faturamento).

### 1.5 `create_stock_adjustment` — nenhum nome de campo confere

`IncluirAjusteEstoque` existe, mas o tipo `estoque_mov_ajuste_cadastro` usa
nomes abreviados. Mapa completo do que a tool envia (`src/index.ts:482-500`)
versus o que a API espera:

| Enviado hoje | Campo real | Observação |
|---|---|---|
| `codigo_produto` | `id_prod` | integer |
| `codigo_produto_integracao` | `cod_int` | string(20) |
| `quantidade` | `quan` | decimal, obrigatório |
| `data_ajuste` | `data` | obrigatório |
| `tipo_ajuste` | `tipo` | ENT/SAI/SLD/TRF ✔ domínio correto |
| `codigo_motivo` (number) | `motivo` | **string(3)**: `INV`, etc. |
| `observacao` | `obs` | obrigatório |
| — | `origem` | **obrigatório**, string(3) — `AJU` p/ ajuste manual |
| — | `cod_int_ajuste` | idempotência da integração |
| — | `codigo_local_estoque_destino` | **obrigatório quando `tipo = "TRF"`** |
| — | `lote_validade` | obrigatório p/ produtos com controle de lote |

Único campo que já está correto: `codigo_local_estoque`. A tool declara `TRF`
no enum sem expor o campo de destino, então mesmo depois de renomear tudo a
transferência continuaria falhando.

### 1.6 `create_cash_entry` — chave no nível errado e domínios inventados

Em `IncluirLancCC`, o tipo `lanccIncluirRequest` é
`{ cCodIntLanc, cabecalho, detalhes, transferencia, departamentos }`, e os
sub-objetos são estritos:

- `cabecalho` aceita **apenas** `nCodCC`, `dDtLanc`, `nValorLanc`.
- `detalhes` aceita `cCodCateg`, `aCodCateg`, `cTipo`, `cNumDoc`,
  `nCodCliente`, `nCodProjeto`, `cObs`.

A descrição do schema (`src/index.ts:455-462`) está errada em quatro pontos:

1. `cCodIntLanc` é **top-level**, não vai dentro de `cabecalho`.
2. `cNatureza` (`E`/`S`) **não existe** — o sinal vem do valor de `nValorLanc`.
3. `cHistorico` **não existe** — a descrição livre é `detalhes.cObs`.
4. `cTipo` fica em `detalhes` e é **tipo de documento** (`DIN`, `BOL`, `CRT`,
   `CHQ`, `CON`, `ADI`…), não `DEB`/`CRE`.
5. `nCodDepto` não existe em `detalhes`; rateio é o array `departamentos`.

Como a descrição é a única especificação que o agente enxerga (o schema só diz
`type: "object"`), ele monta o payload exatamente como está escrito — e falha.

### 1.7 `create_invoice` — chave de consulta inexistente

`src/index.ts:604` envia `nIdNF` para `ConsultarNF`. O tipo de requisição
(`nfChave`) aceita `nCodNF`, `nNF` + `serie`, `cChaveNFe`, `nIdPedido`,
`cnpj_cpf`, `cCodNFInt` (deprecated) — **não** `nIdNF`. `nIdNF` só aparece no
tipo de **resposta** (`compl`), o que explica a confusão. A chave primária de
consulta é `nCodNF`.

---

## 2. Filtros inválidos (P1 — falha silenciosa)

Um campo desconhecido no `param` da Omie, no melhor caso, é ignorado — a
requisição volta 200 e o agente reporta um recorte que nunca foi aplicado.

### 2.1 `get_financial` (ListarContasReceber) — `src/index.ts:596-602`

Envia `dDtEmiInicial` / `dDtEmiFinal`. O tipo `lcrListarRequest` não tem esses
campos. Corretos:

- emissão: `filtrar_por_emissao_de` / `filtrar_por_emissao_ate`
- inclusão/alteração: `filtrar_por_data_de` / `filtrar_por_data_ate`

Vale expor também `filtrar_por_status`, `filtrar_cliente`,
`filtrar_por_cpf_cnpj`, `filtrar_apenas_titulos_em_aberto` e `exibir_obs`,
que são os recortes que um agente financeiro realmente pede.

### 2.2 `list_accounts_payable` — `src/index.ts:635-642`

Envia `dDtVencDe`, `dDtVencAte` e `status_titulo`. Nenhum dos três existe em
`lcpListarRequest`. O status correto é `filtrar_por_status` (valores
`CANCELADO`, `PAGO`, `LIQUIDADO`, `EMABERTO`, `ATRASADO`, `VENCEHOJE`,
`AVENCER`, `PAGTOPARCIAL`).

**Não existe filtro por vencimento nessa API.** Quem faz esse recorte é
`/financas/mf/ ListarMovimentos` (`dDtVencDe`/`dDtVencAte`) — que já está
exposto como `list_financial_movements`. A descrição das duas tools deveria
dizer isso, senão o agente insiste na tool errada.

### 2.3 `list_service_orders` — `src/index.ts:614-619`

Envia `etapa`; em `osListarRequest` o campo é `filtrar_por_etapa`. (Em
`ListarPedidos` — vendas — `etapa` está correto; daí o descuido.) Também
disponível e útil: `filtrar_por_status` (`F`/`N`/`C`), `filtrar_por_cliente`,
`filtrar_por_data_previsao_de`/`_ate`, `cExibirProdutos`.

### 2.4 `get_stock_position` — `src/index.ts:691`

Envia `cExibirTodos`; o campo é **`cExibeTodos`**. Consequência prática: o
"incluir itens com estoque zero" nunca funciona. Também disponíveis:
`lista_local_estoque`, `cTipoItem`, `lista_produtos`.

### 2.5 `pay_account_payable` — `src/index.ts:373-389`

Três problemas no mesmo schema:

- `codigo_baixa` é declarado `string` e **obrigatório**. No tipo
  `conta_pagar_lancar_pagamento`, `codigo_baixa` é **integer** (código gerado
  pela Omie); o código de integração — que é o que uma integração informa — é
  `codigo_baixa_integracao`, string(20).
- Nenhum identificador de título é obrigatório. Ou `codigo_lancamento` ou
  `codigo_lancamento_integracao` precisa vir, senão a baixa não tem título.
  Hoje a tool aceita, valida e dispara uma baixa sem alvo.
- Faltam `desconto`, `juros`, `multa` e `conciliar_documento`, que quase toda
  baixa real usa.

Numa tool que movimenta dinheiro, essa é a correção mais urgente da lista.

### 2.6 `list_financial_movements` — `src/index.ts:477`

`cNatureza` está com `enum: ["R","P","T"]`. O domínio documentado é apenas
`P` (contas a pagar) e `R` (contas a receber) — `T` não existe. Além disso, o
método **retorna só os últimos 30 dias quando nenhum filtro de data é
enviado**; isso precisa estar na descrição, ou o agente conclui que a empresa
não tem histórico.

### 2.7 `update_sales_order` — `src/index.ts:515-529`

`cabecalho`, `observacoes`, `informacoes_adicionais` e `frete` estão corretos
(todos existem no contrato de `AlterarPedidoVenda`). O erro é `itens`: o array
de itens do pedido chama-se **`det`**. O tipo `itens` existe no endpoint, mas
pertence a `DevolverPedido` (`{codigo_produto, quantidade}`) — não serve aqui.

---

## 3. Tools conformes

Confirmadas contra a documentação, sem defeito de contrato:

`list_customers`, `create_customer`, `list_products`, `create_product`,
`list_orders`, `list_invoices`, `get_company_info`, `get_bank_accounts`,
`create_account_payable`, `list_dre`, `get_bank_statement`, `list_categories`,
`list_departments`, `list_projects`, `get_sales_order`, `invoice_sales_order`.

Melhorias opcionais nesse grupo:

| Tool | Sugestão |
|---|---|
| `create_customer` | expor `codigo_cliente_integracao` (chave de idempotência), `telefone1_ddd` (o telefone é dividido em DDD + número) e `complemento`. Considerar `UpsertClienteCpfCnpj` como tool separada — resolve duplicação de cadastro, que é o erro nº 1 de agente |
| `create_product` | expor `codigo_produto_integracao`; os obrigatórios declarados (`descricao`, `unidade`, `ncm`, `valor_unitario`) conferem com a doc |
| `list_products` | falta `filtrar_apenas_omiepdv`, presente no exemplo oficial |
| `list_categories` | expor `filtrar_por_tipo` (`R`/`D`), `filtrar_apenas_ativo`, `descricao` |
| `list_invoices` | `dEmiInicial`/`dEmiFinal` estão corretos; vale expor `filtrar_por_status`, `tpNF`, `cnpj_cpf`, `cApenasResumo` |
| `apenas_importado_api` | está **DEPRECATED** em `ListarNF`, `ListarContasReceber`, `ListarContasPagar`, `ListarPedidos`, `ListarOS` e `ListarEmpresas`. Onde a tool expõe (`list_products`, `list_projects`) ainda é válido |

### Nomes enganosos

Não são bugs de contrato, mas fazem o agente escolher errado:

- **`create_invoice`** consulta uma NF (`ConsultarNF`). Um agente que quer
  emitir nota chama essa tool — e a tool que emite é `invoice_sales_order`.
  Renomear para `get_invoice`.
- **`get_financial`** lista contas a receber. Renomear para
  `list_accounts_receivable`, simétrico a `list_accounts_payable`.
- **`get_company_info`** lista empresas (plural, paginado). `list_companies`.

Renomeações quebram clientes existentes; o caminho barato é registrar o nome
novo e manter o antigo como alias por uma versão.

---

## 4. Problemas transversais

### 4.1 Paginação sem limite superior

O limite da Omie é **100 registros por página** em todos os métodos de
listagem. Nenhum schema declara `maximum`, então o agente pede 500 e recebe
erro. Adicionar `maximum: 100` nos `registros_por_pagina` / `nRegPorPagina` /
`nRegsPorPagina`.

### 4.2 Limites de consumo não tratados — risco de bloqueio de 30 min

Limites publicados: 960 req/min por IP, 240 req/min por IP + App Key + método,
4 requisições simultâneas por IP + App Key + método, e **bloqueio de 30
minutos (HTTP 425) após 10 erros consecutivos** na mesma combinação. Há também
bloqueio de requisição redundante: consultar o mesmo ID duas vezes em menos de
60 segundos devolve dado só na primeira.

`omieRequest` (`src/index.ts:107-125`) não tem retry, backoff, limite de
concorrência nem timeout. O cenário concreto: um agente entra em loop com um
payload malformado — o que, dados os defeitos da seção 1, é o comportamento
esperado hoje — e em dez tentativas derruba a integração inteira por meia
hora. Mínimo recomendável: `AbortSignal.timeout`, backoff exponencial, e
tratamento explícito de 425 **sem retry**, com mensagem dizendo ao agente para
parar.

### 4.3 Erros de negócio chegam como texto cru

A Omie devolve erro de negócio com HTTP 500 e corpo JSON contendo
`faultstring`/`faultcode`. O código faz `res.text()` e concatena numa
`Error` (`src/index.ts:120-123`), então o agente recebe
`Omie API 500: {"faultstring":"ERROR: ...","faultcode":"SOAP-ENV:Client-101"}`.
Parsear e devolver `{ faultcode, faultstring }` estruturado permite que o
agente distinga "cliente não encontrado" de "instabilidade" e decida se
repete.

### 4.4 Credenciais ausentes falham tarde

`APP_KEY`/`APP_SECRET` default para `""` (`src/index.ts:73-74`) e a chamada
segue para a Omie, que responde com erro genérico de autenticação. Falhar no
startup (stdio) ou responder com erro claro na primeira tool torna o problema
diagnosticável.

### 4.5 Validação de entrada — parcialmente resolvido em 0.2.3

Até 0.2.2 não havia validação alguma: `args` ia cru para `param[0]` em todas
as tools de escrita e o agente só descobria o erro pelo 500 da Omie. 0.2.3
adiciona um validador que percorre o próprio `inputSchema` da tool
(obrigatórios, tipo objeto/array, `minItems`) antes do envio, então campo
faltando vira mensagem local nomeando o campo.

O que ainda falta: o validador não confere tipos escalares nem `enum`, e não
expressa as regras "um dos dois" — `codigo_produto` **ou**
`codigo_produto_integracao`, `nCodFor` **ou** `cCodIntFor`, `id_prod` **ou**
`cod_int` — que hoje vivem só na descrição.

### 4.6 Modo demo cobre 7 de 30 tools

`DEMO_RESPONSES` (`src/index.ts:63-71`) tem resposta para 7 tools; as outras
23 retornam `{demo:true, tool:name}`. Como o fallback nunca falha, o modo demo
dá a impressão de que tudo funciona.

### 4.7 A suíte de testes não testava o contrato — resolvido em 0.2.3

Até 0.2.2, `src/__tests__/index.test.ts` tinha 53 linhas: contava as tools e
verificava `ListarClientes`. Um teste table-driven percorrendo as 30 e
afirmando `(path, call)` teria pego 1.1 e 1.2 (métodos inexistentes) no
primeiro run. A suíte agora tem:

1. tabela `tool → { path, call }` verificada para as 30, mais a asserção de
   que a lista de tools registradas é exatamente a da tabela;
2. verificação da forma do `param` das 7 tools reescritas, incluindo a
   ausência das chaves antigas (`itens`, `codigo_produto`, `tipo_ajuste`…);
3. casos de validação: pedido sem `etapa`/`codigo_parcela` e ajuste sem
   `origem`/`motivo` falham **sem** chamar a Omie.

Ainda falta cobrir os filtros da seção 2 e um teste de que
`registros_por_pagina > 100` é rejeitado (depende de 4.1).

### 4.8 Transporte HTTP: cópia de handlers privados e sessões sem TTL

Fora do escopo API-vs-doc, mas vale registrar: `src/index.ts:826` cria um
`Server` novo por sessão e copia `_requestHandlers` / `_notificationHandlers`
por acesso a campo privado do SDK — quebra silenciosamente numa atualização
do `@modelcontextprotocol/sdk`. Expor uma `function buildServer()` que
registra os handlers resolve. O `Map` de transports também não tem expiração:
sessões que somem sem `DELETE` ficam retidas até o restart.

---

## 5. Tools que poderiam ser desenvolvidas

O catálogo cobre 20 dos ~150 endpoints da Omie. As lacunas abaixo estão
ordenadas por valor para um agente, não por facilidade.

### 5.1 Financeiro — a maior assimetria do servidor

O lado a pagar tem criar/listar/baixar; o lado a receber é **somente
leitura**. Um agente consegue pagar um fornecedor, mas não consegue registrar
nem baixar um recebimento.

| Tool sugerida | Endpoint / método |
|---|---|
| `create_account_receivable` | `/financas/contareceber/ IncluirContaReceber` |
| `receive_account_receivable` | `/financas/contareceber/ LancarRecebimento` |
| `update_account_receivable` | `AlterarContaReceber` / `UpsertContaReceber` |
| `cancel_receipt` | `CancelarRecebimento` |
| `reconcile_receipt` | `ConciliarRecebimento` / `DesconciliarRecebimento` |
| `update_account_payable` | `/financas/contapagar/ AlterarContaPagar` |
| `cancel_payment` | `CancelarPagamento` |
| `list_cash_entries` / `update` / `delete` | `/financas/contacorrentelancamentos/ ListarLancCC`, `AlterarLancCC`, `ExcluirLancCC` (hoje só existe o incluir) |

### 5.2 Cobrança — PIX e boleto

Provavelmente o maior ganho por linha de código para agentes de cobrança:

| Tool | Endpoint / método |
|---|---|
| `create_pix` / `get_pix_qrcode` / `get_pix_status` / `cancel_pix` | `/financas/pix/ GerarPix`, `GerarQrCodePix`, `ObterStatusPix`, `ListarPix`, `CancelarPix` |
| `generate_boleto` / `get_boleto` / `cancel_boleto` / `extend_boleto` | `/financas/contareceberboleto/ GerarBoleto`, `ObterBoleto`, `CancelarBoleto`, `ProrrogarBoleto` |
| `get_boleto_url` | `/financas/pesquisartitulos/ ObterURLBoleto` |
| `get_finance_summary` | `/financas/resumo/ ObterResumoFinancas`, `ObterListaEmAberto` |

### 5.3 Ciclo de vida do pedido de venda

Hoje dá para criar, alterar, consultar e faturar. Falta tudo entre isso:

| Tool | Método |
|---|---|
| `get_order_status` | `/produtos/pedido/ StatusPedido` |
| `change_order_stage` | `TrocarEtapaPedido` |
| `simulate_order_taxes` | `SimularImpostos` — permite cotar antes de gravar |
| `validate_order` | `/produtos/pedidovendafat/ ValidarPedidoVenda` — valida antes de faturar; reduz muito o retrabalho do agente |
| `cancel_order` | `/produtos/pedidovendafat/ CancelarPedidoVenda` |
| `delete_order` / `return_order` | `ExcluirPedido` / `DevolverPedido` |
| `list_order_stages` | `/produtos/pedidoetapas/ ListarEtapasPedido` e `/produtos/etapafat/` |
| `get_invoice_pdf` / `get_invoice_xml` | `/produtos/dfedocs/ ObterNfe`, `ObterDanfeSimp` — pedido recorrente e hoje impossível |
| `import_nfe` | `/produtos/nfe/ ImportarNFe` |

### 5.4 Serviços

`invoice_sales_order` existe, mas o equivalente para OS não:

| Tool | Método |
|---|---|
| `invoice_service_order` | `/servicos/osp/ FaturarOS` |
| `validate_service_order` / `cancel_service_order` | `ValidarOS` / `CancelarOS` |
| `get_service_order` / `update_service_order` / `change_os_stage` | `/servicos/os/ ConsultarOS`, `AlterarOS`, `StatusOS`, `TrocarEtapaOS` |
| `list_services` / `create_service` | `/servicos/servico/` |
| `list_nfse` | `/servicos/nfse/ ListarNFSEs` |
| `create_service_contract` | `/servicos/contrato/` — já consta no roadmap v0.3 |

### 5.5 Cadastros — CRUD incompleto

Toda entidade tem só listar/incluir; falta consultar, alterar e — o mais
importante para agentes — **upsert**:

| Tool | Método |
|---|---|
| `get_customer` / `update_customer` / `upsert_customer` | `ConsultarCliente`, `AlterarCliente`, `UpsertCliente`, `UpsertClienteCpfCnpj` |
| `get_product` / `update_product` / `upsert_product` | `ConsultarProduto`, `AlterarProduto`, `UpsertProduto` |
| `list_payment_terms` | `/geral/parcelas/ ListarParcelas` — **necessário**: `codigo_parcela` é obrigatório no pedido de venda e hoje o agente não tem como descobrir os valores válidos |
| `list_stock_locations` | `/estoque/local/ ListarLocaisEstoque` — mesma situação para `codigo_local_estoque` |
| `list_salespeople` | `/geral/vendedores/` |
| `list_price_tables` | `/produtos/tabelaprecos/` |
| `create_category` | `/geral/categorias/ IncluirCategoria` |

As duas linhas marcadas como "necessário" são pré-requisito das tools de
escrita que já existem: sem elas o agente precisa adivinhar códigos
obrigatórios.

### 5.6 Estoque, compras e produção

| Tool | Endpoint |
|---|---|
| `list_stock_movements` / `get_product_stock` | `/estoque/consulta/ ListarMovimentoEstoque`, `PosicaoEstoque` |
| `list_stock_adjustments` / `delete_stock_adjustment` | `/estoque/ajuste/ ListarAjusteEstoque`, `ExcluirAjusteEstoque` |
| `create_purchase_request` | `/produtos/requisicaocompra/` |
| `create_incoming_note` | `/produtos/notaentrada/` + `/produtos/notaentradafat/` |
| `create_production_order` | `/produtos/op/` — roadmap v0.3 |
| `receive_nfe` | `/produtos/recebimentonfe/` |

### 5.7 CRM — 19 endpoints, cobertura zero

`/crm/oportunidades/`, `/crm/contatos/`, `/crm/tarefas/`, `/crm/fases/`,
`/crm/contas/` e outros 14 não têm nenhuma tool. Se o público-alvo incluir
agentes comerciais, é a maior área branca do servidor — e um funil de vendas
lido e atualizado por agente é um caso de uso mais óbvio que boa parte do que
já está implementado.

### 5.8 Contador e anexos

`/contador/xml/` (download de XMLs fiscais do período) e `/contador/resumo/`
atendem o fluxo de fechamento contábil. `/geral/anexo/`
(`IncluirAnexo`/`ObterAnexo`) permite anexar comprovante a título — comum em
automação de contas a pagar.

---

## 6. Sequência sugerida

1. ~~**Corrigir as 7 quebradas** (seção 1)~~ — feito em 0.2.3.
2. **Corrigir `pay_account_payable`** (2.5) — é a tool que move dinheiro e a
   que hoje aceita uma baixa sem título.
3. **Corrigir os filtros** (2.1–2.4, 2.6, 2.7) — falha silenciosa é pior que
   erro, porque o usuário recebe um número errado sem aviso.
4. ~~**Teste table-driven de contrato** (4.7)~~ — feito em 0.2.3: as 30 tools
   têm `(path, call)` fixados e as 7 reescritas têm a forma do `param`
   verificada. Falta estender o mesmo padrão aos filtros da seção 2.
5. **Backoff, timeout e tratamento de 425** (4.2).
6. **`maximum: 100` na paginação** e revisão das descrições (4.1, 2.6).
7. Aí sim, novas tools — começando por `receive_account_receivable`,
   `list_payment_terms` e `list_stock_locations`, que desbloqueiam fluxos já
   existentes, antes de abrir frentes novas como PIX e CRM.

---

## Referências

- [Lista de APIs Omie](https://developer.omie.com.br/service-list/) — índice dos endpoints
- Páginas de referência por endpoint: `https://app.omie.com.br/api/v1/<recurso>/` (métodos, exemplos e tipos complexos)
- [Limites de consumo da API do Omie](https://ajuda.omie.com.br/pt-BR/articles/8112984-limites-de-consumo-da-api-do-omie)
- [Tratando os erros de API](https://ajuda.omie.com.br/pt-BR/articles/8001888-tratando-os-erros-de-api)
- [Incluindo um Orçamento ou Pedido de Venda via API](https://ajuda.omie.com.br/pt-BR/articles/6596152-incluindo-um-orcamento-ou-pedido-de-venda-via-api)
- [Criando um Pedido de Compra por API](https://ajuda.omie.com.br/pt-BR/articles/6792662-criando-um-pedido-de-compra-por-api)
- [Cadastrando uma Ordem de Serviço via API](https://ajuda.omie.com.br/pt-BR/articles/6891433-cadastrando-uma-ordem-de-servico-via-api)
