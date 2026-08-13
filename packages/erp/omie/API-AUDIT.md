# Auditoria das tools do MCP Omie × documentação oficial da API

_Data: 2026-08-12 — versão auditada: `mcp-omie` 0.2.2 (30 tools, `src/index.ts`)._

> **Status por versão:**
>
> - **0.2.3** — as 7 tools quebradas da seção 1 foram corrigidas: schemas
>   reescritos conforme o contrato documentado, validação de argumentos antes
>   do envio e teste de contrato cobrindo as 30 tools.
> - **0.3.0** — a seção 5 (tools ausentes) foi implementada em grande parte:
>   **52 tools novas**, servidor passa de 30 para 82. As definições viraram
>   declarativas (`path`/`call` junto do schema, em `src/tools/*`), então o
>   teste de contrato deriva as expectativas das próprias definições.
> - **0.4.0** — a **seção 2 foi fechada**: os 7 filtros inexistentes foram
>   substituídos pelos campos documentados, `pay_account_payable` passou a
>   tipar `codigo_baixa` como o inteiro da Omie (com `codigo_baixa_integracao`
>   para o código do integrador) e o teste de contrato agora trava, tool a
>   tool, os nomes proibidos e os obrigatórios.
> - **0.5.0** — a **seção 4 foi fechada** (com uma exceção): retry com
>   backoff exponencial restrito a métodos de leitura (`Listar*`,
>   `Consultar*`, `Obter*`, `Pesquisar*`, `Status*`, `Simular*`, `Validar*`),
>   HTTP 425 nunca repetido, HTTP 500 nunca repetido (a Omie usa o mesmo
>   código para erro de negócio permanente e instabilidade transitória — ver
>   4.2), `faultstring`/`faultcode` estruturados em `OmieApiError`, validação
>   estendida com tipo escalar/`enum`/`maximum`/`minimum`, credenciais
>   ausentes falham no primeiro uso com aviso adicional no startup, demo mode
>   com fallback que ecoa os argumentos validados em vez de fingir sucesso, e
>   `buildServer()` substituindo o acesso a campos privados do SDK + expiração
>   de sessão HTTP ociosa. Ficou de fora: as regras "um dos dois campos" (4.5)
>   e cobertura maior do demo mode (4.6).
> - **0.6.0** — **seção 4 fechada por completo**: `anyOfRequired` no
>   validador cobre as regras "pelo menos um destes campos" em 39 pontos
>   across 8 módulos (identificação de cliente/produto/pedido/OS/pedido de
>   compra/título financeiro/PIX/boleto/ajuste de estoque), com os casos
>   genuinamente condicionais (não "pelo menos um de N") deixados de fora e
>   documentados abaixo. Demo mode cresceu de 9 para 22 tools curadas,
>   verificadas contra o tipo de resposta real da Omie.
> - **Aberto:** o que restou da seção 5 — CRM, contador, ordem de produção,
>   contratos de serviço, tabelas de preço.

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
| ⚠️ Chamada correta, **parâmetro inválido** (filtro ignorado ou erro) | 7 | ✔ corrigidos em 0.4.0 |
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

## 2. Filtros inválidos (P1 — falha silenciosa) — corrigidos em 0.4.0

O diagnóstico abaixo descreve o estado até 0.3.0. Cada campo foi substituído
pelo nome documentado e o teste de contrato passou a travar os dois lados: os
nomes que não podem voltar (`dDtEmiInicial`, `dDtVencDe`, `status_titulo`,
`etapa` em OS, `cExibirTodos`, `itens` em `AlterarPedidoVenda`) e os que
precisam existir (`filtrar_por_emissao_de`, `filtrar_por_status`,
`filtrar_por_etapa`, `cExibeTodos`, `det`).

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

## 4. Problemas transversais — fechada em 0.5.0 (com uma exceção em 4.5)

O diagnóstico abaixo descreve o estado até 0.4.0. `src/index.ts` foi dividido
em `src/index.ts` (servidor/transporte) e `src/omie.ts` (transporte HTTP para
a Omie + validação), e ganhou `src/__tests__/omie.test.ts` dedicado a essa
camada.

### 4.1 Paginação sem limite superior — resolvido em 0.3.0

`pagingSchema()` (`src/tools/types.ts`) declara `maximum: 100` em todo campo
de tamanho de página, nas três grafias (`registros_por_pagina`,
`nRegPorPagina`, `nRegsPorPagina`). A partir de 0.5.0 isso também é
**imposto**, não só documentado: `validateArgs` rejeita `> 100` antes do
envio (ver 4.5).

### 4.2 Limites de consumo — resolvido em 0.5.0

`omieRequest` (`src/omie.ts`) agora tem timeout (`AbortSignal.timeout`,
`OMIE_REQUEST_TIMEOUT_MS`, default 20s) e retry com backoff exponencial +
jitter — mas restrito de um jeito que o "mínimo recomendável" original não
detalhava e que se mostrou necessário:

- **Só métodos de leitura são repetidos** (`Listar*`, `Consultar*`,
  `Obter*`, `Pesquisar*`, `Status*`, `Simular*`, `Validar*`, mais o caso único
  `PosicaoEstoque`). Um timeout numa escrita é ambíguo — a Omie pode ter
  processado a chamada mesmo sem a resposta voltar — e repetir
  `create_order`/`pay_account_payable`/`create_pix` nessa ambiguidade arrisca
  duplicar pedido, pagamento ou cobrança. Prefixo desconhecido é tratado como
  escrita por padrão (fail-safe).
- **HTTP 500 nunca é repetido**, nem para leitura. A Omie usa o mesmo código
  para erro de negócio permanente ("cliente não encontrado") e instabilidade
  transitória — repetir todo 500 repetiria o caso irrecuperável e gastaria o
  mesmo orçamento de 10 erros que leva ao bloqueio de 425. Só falha de rede e
  502/503/504 são repetidos, até 2 vezes.
- **HTTP 425 nunca é repetido**, leitura ou escrita — repetir dentro de um
  bloqueio ativo não pode ter sucesso.

Limite de concorrência (4 requisições simultâneas por IP+AppKey+método) **não
foi implementado** — decisão deliberada de escopo, não descoberta durante a
implementação: um limitador global seria conservador demais (o limite real é
por combinação de método) e um por-método exigiria rastrear a chave certa por
chamada. Fica como possível trabalho futuro.

### 4.3 Erros de negócio — resolvido em 0.5.0

`OmieApiError` (`src/omie.ts`) faz `JSON.parse` do corpo do erro e expõe
`httpStatus`, `faultCode` e `faultString` como campos tipados. A mensagem
renderizada separa as duas linhas (`faultcode: ...` / `faultstring: ...`) em
vez de concatenar o JSON cru na mensagem, e o caso 425 tem uma mensagem própria
dizendo explicitamente para não repetir agora.

### 4.4 Credenciais ausentes — resolvido em 0.5.0

`omieRequest` falha imediatamente (sem tocar a rede) se `OMIE_APP_KEY` ou
`OMIE_APP_SECRET` estiverem ausentes, com mensagem citando as duas variáveis.
Adicionalmente, `main()` emite um aviso não-fatal no startup nesse mesmo caso
— não-fatal porque `tools/list` e o modo demo continuam funcionando sem
credenciais, então encerrar o processo seria mais agressivo do que o
necessário.

### 4.5 Validação de entrada — fechada em 0.6.0

`validateArgs` (`src/omie.ts`) confere tipo escalar (`string`, `number`,
`boolean`), `enum`, `minimum`/`maximum` numérico (desde 0.5.0), e agora — via
`anyOfRequired: string[]` no schema de um objeto — "identifique este registro
por pelo menos um destes campos irmãos". Não é `oneOf`/`anyOf` genérico do
JSON Schema (que exigiria resolver subschemas divergentes); é uma construção
única, propositalmente estreita, porque todo caso real neste codebase é
exatamente esse padrão — "um entre N campos de ID alternativos" — nunca um
formato genuinamente diferente por ramo.

Aplicado em 39 pontos, em 8 módulos: `get_customer`/`update_customer`
(`codigo_cliente_omie` ou `codigo_cliente_integracao`),
`get_product`/`update_product` (3 vias: `codigo_produto`,
`codigo_produto_integracao`, `codigo`), o ciclo do pedido de venda inteiro
(`orderKey`/`fatKey`, 10 tools), o ciclo da OS (`osKey`, 6 tools),
`create_purchase_order` (fornecedor por `nCodFor`/`cCodIntFor`/`cCnpjCpfFor`
e cada item por `nCodProd`/`cCodIntProd`), PIX e boleto (6 tools),
`create_stock_adjustment`/`get_product_stock` (`id_prod`/`cod_int`), e o lado
financeiro completo — títulos AR/AP, `receive_account_receivable` e
`pay_account_payable` (esta última é exatamente o caso que a própria
descrição da tool já dizia: "without one of them the settlement has no
target", mas que antes de 0.6.0 não era verificado).

**Deliberadamente não aplicado:** `update_sales_order.det[].produto` (uma
remoção de item via `ide.acao_item="E"` pode não precisar de dados de
produto — aplicar a regra bloquearia uma chamada de update legítima);
`create_invoice` (identificação por `nCodNF`, `cChaveNFe`, ou `nNF`+`serie`
combinados — a combinação obrigatória de `nNF` com `serie` é uma regra
condicional mais fina do que "pelo menos um destes", e a doc da Omie não
confirma se `nIdPedido`/`cnpj_cpf` sozinhos também identificam um registro
único); `get_bank_statement` (`nCodCC`/`cCodIntCC` marcados "opt" na doc da
Omie sem confirmação de que um dos dois é obrigatório — pode ser que a
ausência signifique "todas as contas"); e o campo condicional de
`servicoPrestado` (se `nCodServico` estiver ausente, `cTribServ`/
`cCodServMun`/`cCodServLC116`/`cDescServ` passam a ser obrigatórios — isso é
"se A ausente, então B∧C∧D obrigatórios", não "pelo menos um de N").

### 4.6 Modo demo — expandido em 0.6.0

`DEMO_RESPONSES` cresceu de 9 para **22 tools** curadas, todas verificadas
contra o tipo de resposta real da Omie (ex.: `LancarPagamento` →
`conta_pagar_lancar_pagamento_resposta`, `GerarPix` → `GerarPixResponse`,
`IncluirPedCompra` → `com_pedido_incluir_response`) — não inventadas. O lote
novo cobre o financeiro de baixa (`pay_account_payable`,
`receive_account_receivable`, `create_account_payable`,
`create_account_receivable`), o ciclo do pedido (`get_order_status`,
`change_order_stage`, `invoice_sales_order`, `validate_order`), PIX
(`create_pix`, `get_pix_status`), e `create_stock_adjustment`,
`create_cash_entry`, `create_purchase_order`.

Para as 60 tools restantes, o fallback (`{ demo: true, tool, note,
would_send }`, adicionado em 0.5.0) continua ecoando os argumentos
validados em vez de fingir um formato de resposta não verificado — estender
a curadoria further exige extrair mais tipos `*_response`/`*_resposta`/
`*Response` da referência da Omie, não adivinhar JSON plausível.

### 4.7 A suíte de testes — resolvido em 0.2.3, ampliado em 0.4.0/0.5.0

Ver histórico nas versões anteriores desta seção. Em 0.5.0 a suíte ganhou
`src/__tests__/omie.test.ts` (33 testes) cobrindo especificamente retry,
backoff, classificação leitura/escrita, `OmieApiError` e a validação
estendida — com fake timers, então roda em ~100ms sem esperas reais.

### 4.8 Transporte HTTP — resolvido em 0.5.0

`buildServer()` em `src/index.ts` constrói cada `Server` (um por sessão HTTP)
registrando os handlers pela API pública (`setRequestHandler`), eliminando o
acesso a `_requestHandlers`/`_notificationHandlers` — campos privados do SDK
que uma atualização podia quebrar silenciosamente. As sessões HTTP agora
carregam `lastSeenAt` e uma varredura periódica (`MCP_SESSION_IDLE_TIMEOUT_MS`,
default 30 min) fecha e remove sessões que sumiram sem `DELETE`, em vez de
retê-las até o restart.

Não coberto por teste automatizado: o caminho HTTP (sessões, TTL, OAuth) não
tinha testes antes desta mudança e continua sem — testá-lo exigiria subir um
servidor `express` real ou mockar a camada de transporte, o que não foi
tentado aqui.

---

## 5. Tools que poderiam ser desenvolvidas — em grande parte entregue em 0.3.0

> **0.3.0 entregou 52 das tools abaixo.** Marcadas com ✅ as que existem hoje.
> O que ficou de fora, e por quê: **CRM** (`/crm/*`, 19 endpoints) é um domínio
> distinto do ERP e provavelmente merece servidor próprio; **contador**, **ordem
> de produção**, **contratos de serviço**, **tabelas de preço**, **requisição de
> compra**, **nota de entrada** e **anexos** seguem na fila.
>
> Entregue por bloco: financeiro AR/AP (11 ✅), PIX + boleto (8 ✅), ciclo do
> pedido de venda (9 ✅), serviços/OS (8 ✅), cadastros e apoio (10 ✅), estoque
> (4 ✅), compras (1 ✅), NFS-e (1 ✅).

O catálogo cobre 20 dos ~150 endpoints da Omie. As lacunas abaixo estão
ordenadas por valor para um agente, não por facilidade.

### 5.1 Financeiro — a maior assimetria do servidor

O lado a pagar tem criar/listar/baixar; o lado a receber é **somente
leitura**. Um agente consegue pagar um fornecedor, mas não consegue registrar
nem baixar um recebimento.

| Tool sugerida | Endpoint / método |
|---|---|
| ✅ `create_account_receivable` | `/financas/contareceber/ IncluirContaReceber` |
| ✅ `receive_account_receivable` | `/financas/contareceber/ LancarRecebimento` |
| ✅ `update_account_receivable` | `AlterarContaReceber` / `UpsertContaReceber` |
| ✅ `cancel_receipt` | `CancelarRecebimento` |
| `reconcile_receipt` | `ConciliarRecebimento` / `DesconciliarRecebimento` |
| ✅ `update_account_payable` | `/financas/contapagar/ AlterarContaPagar` |
| ✅ `cancel_payment` | `CancelarPagamento` |
| ✅ `list_cash_entries` / `update` / `delete` | `/financas/contacorrentelancamentos/ ListarLancCC`, `AlterarLancCC`, `ExcluirLancCC` (hoje só existe o incluir) |

### 5.2 Cobrança — PIX e boleto

Provavelmente o maior ganho por linha de código para agentes de cobrança:

| Tool | Endpoint / método |
|---|---|
| ✅ `create_pix` / `get_pix_qrcode` / `get_pix_status` / `cancel_pix` | `/financas/pix/ GerarPix`, `GerarQrCodePix`, `ObterStatusPix`, `ListarPix`, `CancelarPix` |
| ✅ `generate_boleto` / `get_boleto` / `cancel_boleto` / `extend_boleto` | `/financas/contareceberboleto/ GerarBoleto`, `ObterBoleto`, `CancelarBoleto`, `ProrrogarBoleto` |
| `get_boleto_url` | `/financas/pesquisartitulos/ ObterURLBoleto` |
| ✅ `get_finance_summary` | `/financas/resumo/ ObterResumoFinancas`, `ObterListaEmAberto` |

### 5.3 Ciclo de vida do pedido de venda

Hoje dá para criar, alterar, consultar e faturar. Falta tudo entre isso:

| Tool | Método |
|---|---|
| ✅ `get_order_status` | `/produtos/pedido/ StatusPedido` |
| ✅ `change_order_stage` | `TrocarEtapaPedido` |
| ✅ `simulate_order_taxes` | `SimularImpostos` — permite cotar antes de gravar |
| ✅ `validate_order` | `/produtos/pedidovendafat/ ValidarPedidoVenda` — valida antes de faturar; reduz muito o retrabalho do agente |
| ✅ `cancel_order` | `/produtos/pedidovendafat/ CancelarPedidoVenda` |
| ✅ `delete_order` / `return_order` | `ExcluirPedido` / `DevolverPedido` |
| ✅ `list_order_stages` | `/produtos/pedidoetapas/ ListarEtapasPedido` e `/produtos/etapafat/` |
| ✅ `get_invoice_pdf` / `get_invoice_xml` | `/produtos/dfedocs/ ObterNfe`, `ObterDanfeSimp` — pedido recorrente e hoje impossível |
| `import_nfe` | `/produtos/nfe/ ImportarNFe` |

### 5.4 Serviços

`invoice_sales_order` existe, mas o equivalente para OS não:

| Tool | Método |
|---|---|
| ✅ `invoice_service_order` | `/servicos/osp/ FaturarOS` |
| ✅ `validate_service_order` / `cancel_service_order` | `ValidarOS` / `CancelarOS` |
| ✅ `get_service_order` / `update_service_order` / `change_os_stage` | `/servicos/os/ ConsultarOS`, `AlterarOS`, `StatusOS`, `TrocarEtapaOS` |
| ✅ `list_services` / `create_service` | `/servicos/servico/` |
| ✅ `list_nfse` | `/servicos/nfse/ ListarNFSEs` |
| `create_service_contract` | `/servicos/contrato/` — já consta no roadmap v0.3 |

### 5.5 Cadastros — CRUD incompleto

Toda entidade tem só listar/incluir; falta consultar, alterar e — o mais
importante para agentes — **upsert**:

| Tool | Método |
|---|---|
| ✅ `get_customer` / `update_customer` / `upsert_customer` | `ConsultarCliente`, `AlterarCliente`, `UpsertCliente`, `UpsertClienteCpfCnpj` |
| ✅ `get_product` / `update_product` / `upsert_product` | `ConsultarProduto`, `AlterarProduto`, `UpsertProduto` |
| ✅ `list_payment_terms` | `/geral/parcelas/ ListarParcelas` — **necessário**: `codigo_parcela` é obrigatório no pedido de venda e hoje o agente não tem como descobrir os valores válidos |
| ✅ `list_stock_locations` | `/estoque/local/ ListarLocaisEstoque` — mesma situação para `codigo_local_estoque` |
| ✅ `list_salespeople` | `/geral/vendedores/` |
| `list_price_tables` | `/produtos/tabelaprecos/` |
| `create_category` | `/geral/categorias/ IncluirCategoria` |

As duas linhas marcadas como "necessário" são pré-requisito das tools de
escrita que já existem: sem elas o agente precisa adivinhar códigos
obrigatórios.

### 5.6 Estoque, compras e produção

| Tool | Endpoint |
|---|---|
| ✅ `list_stock_movements` / `get_product_stock` | `/estoque/consulta/ ListarMovimentoEstoque`, `PosicaoEstoque` |
| ✅ `list_stock_adjustments` / `delete_stock_adjustment` | `/estoque/ajuste/ ListarAjusteEstoque`, `ExcluirAjusteEstoque` |
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
