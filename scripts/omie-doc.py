#!/usr/bin/env python3
"""
Extract the request contract of Omie API methods from Omie's own reference.

Omie publishes, per endpoint, an HTML page listing every method, an example
payload, and the field-by-field definition of each complex type. That page is
the only machine-readable statement of what a method actually accepts — and
three separate defect classes in packages/erp/omie came from guessing instead
of reading it:

  * methods that do not exist (IncluirPedidoCompra, ListarPedidosCompra)
  * filter fields that do not exist (dDtEmiInicial, cExibirTodos, ...)
  * the wrong one of Omie's three pagination spellings (pagina /
    registros_por_pagina vs nPagina / nRegPorPagina vs nPagina /
    nRegsPorPagina), which fails loudly on some endpoints and silently
    returns page 1 forever on others

This script turns that page into JSON so the contract test can assert the
tool schemas against it instead of against a hand-maintained table.

Usage:
  # Human-readable dump of one endpoint
  python3 scripts/omie-doc.py show geral/categorias

  # Regenerate the fixture the contract test reads
  python3 scripts/omie-doc.py fixture \\
      --out packages/erp/omie/src/__tests__/fixtures/omie-request-fields.json

Pages are cached under .omie-doc-cache/ (gitignored) so repeated runs don't
hammer Omie. Delete that directory to force a refetch.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

BASE = "https://app.omie.com.br/api/v1"
CACHE = Path(__file__).resolve().parent.parent / ".omie-doc-cache"

# Tool name -> (endpoint path, Omie method). Kept here rather than parsed out
# of the TypeScript so the fixture is regenerated from an explicit list a human
# reviewed, not from whatever the code currently happens to claim.
TOOL_METHODS: dict[str, tuple[str, str]] = {
    # customers / products
    "list_customers": ("geral/clientes", "ListarClientes"),
    "list_customers_summary": ("geral/clientes", "ListarClientesResumido"),
    "get_customer": ("geral/clientes", "ConsultarCliente"),
    "list_products": ("geral/produtos", "ListarProdutos"),
    "get_product": ("geral/produtos", "ConsultarProduto"),
    # sales
    "list_orders": ("produtos/pedido", "ListarPedidos"),
    "get_sales_order": ("produtos/pedido", "ConsultarPedido"),
    "get_order_status": ("produtos/pedido", "StatusPedido"),
    "list_order_stages": ("produtos/pedidoetapas", "ListarEtapasPedido"),
    "list_invoices": ("produtos/nfconsultar", "ListarNF"),
    # purchasing
    "list_purchase_orders": ("produtos/pedidocompra", "PesquisarPedCompra"),
    "get_purchase_order": ("produtos/pedidocompra", "ConsultarPedCompra"),
    # services
    "list_service_orders": ("servicos/os", "ListarOS"),
    "get_service_order": ("servicos/os", "ConsultarOS"),
    "list_services": ("servicos/servico", "ListarCadastroServico"),
    "list_nfse": ("servicos/nfse", "ListarNFSEs"),
    # finance
    "get_financial": ("financas/contareceber", "ListarContasReceber"),
    "list_accounts_payable": ("financas/contapagar", "ListarContasPagar"),
    "list_cash_entries": ("financas/contacorrentelancamentos", "ListarLancCC"),
    "list_financial_movements": ("financas/mf", "ListarMovimentos"),
    "get_bank_statement": ("financas/extrato", "ListarExtrato"),
    "list_open_titles": ("financas/resumo", "ObterListaEmAberto"),
    "list_pix": ("financas/pix", "ListarPix"),
    # bank reconciliation
    "list_unreconciled_entries": ("financas/extrato", "ListarExtrato"),
    "get_cash_entry": ("financas/contacorrentelancamentos", "ConsultaLancCC"),
    "reconcile_receipt": ("financas/contareceber", "ConciliarRecebimento"),
    "unreconcile_receipt": ("financas/contareceber", "DesconciliarRecebimento"),
    # finance / billing writes whose Omie defaults or key spellings have bitten
    # (lDel deletes the title by default; codigo_baixa_integracao was missing)
    "get_account_receivable": ("financas/contareceber", "ConsultarContaReceber"),
    "cancel_receipt": ("financas/contareceber", "CancelarRecebimento"),
    "cancel_payment": ("financas/contapagar", "CancelarPagamento"),
    "create_pix": ("financas/pix", "GerarPix"),
    "get_pix_qrcode": ("financas/pix", "GerarQrCodePix"),
    "get_pix_status": ("financas/pix", "ObterStatusPix"),
    "cancel_pix": ("financas/pix", "CancelarPix"),
    "generate_boleto": ("financas/contareceberboleto", "GerarBoleto"),
    "get_boleto": ("financas/contareceberboleto", "ObterBoleto"),
    "extend_boleto": ("financas/contareceberboleto", "ProrrogarBoleto"),
    "cancel_boleto": ("financas/contareceberboleto", "CancelarBoleto"),
    "cancel_service_order": ("servicos/osp", "CancelarOS"),
    # stock
    "get_stock_position": ("estoque/consulta", "ListarPosEstoque"),
    "list_stock_movements": ("estoque/consulta", "ListarMovimentoEstoque"),
    "list_stock_adjustments": ("estoque/ajuste", "ListarAjusteEstoque"),
    "list_stock_locations": ("estoque/local", "ListarLocaisEstoque"),
    # registries
    "list_categories": ("geral/categorias", "ListarCategorias"),
    "list_departments": ("geral/departamentos", "ListarDepartamentos"),
    "list_projects": ("geral/projetos", "ListarProjetos"),
    "list_payment_terms": ("geral/parcelas", "ListarParcelas"),
    "list_salespeople": ("geral/vendedores", "ListarVendedores"),
    "get_bank_accounts": ("geral/contacorrente", "ListarContasCorrentes"),
    "get_company_info": ("geral/empresas", "ListarEmpresas"),
    "list_dre": ("geral/dre", "ListarCadastroDRE"),
}


def fetch(path: str) -> str:
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / (path.strip("/").replace("/", "_") + ".html")
    if not cached.exists():
        url = f"{BASE}/{path.strip('/')}/"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        cached.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    return cached.read_text(encoding="utf-8", errors="replace")


def _strip(s: str) -> str:
    return html.unescape(re.sub("<[^>]+>", "", s)).strip()


def request_type_of(page: str, method: str) -> str | None:
    """The complex type named as the method's single request parameter."""
    block = re.search(
        r'<div id="%s" class="methodItem">(.*?)(?=<div id="[^"]+" class="methodItem">|<h2)' % re.escape(method),
        page, re.S,
    )
    if not block:
        return None
    ref = re.search(r'class="method-parameter-type"><a href="#([^"]+)"', block.group(1))
    return ref.group(1) if ref else None


def complex_types(page: str) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for chunk in re.split(r'<div class="complexTypeItem">', page)[1:]:
        named = re.search(r'<a name="([^"]+)"', chunk)
        if not named:
            continue
        fields = []
        # One field per parameter-name cell. Omie omits the parameter-docs
        # cell entirely for a field with no description, so the three cells
        # cannot be matched as one pattern: a lazy match across them used to
        # run on into the next row, gluing fields together
        # ("string10\n\n\ncExibeTodos\nstring1") and dropping the one after.
        # Each row is cut at the next parameter-name cell and the docs cell is
        # looked for only inside it.
        starts = [m.start() for m in re.finditer(r'<td class="parameter-name ', chunk)]
        for begin, end in zip(starts, starts[1:] + [len(chunk)]):
            row = chunk[begin:end]
            name = re.match(r'<td class="parameter-name parameter-\w+">(.*?)</td>', row, re.S)
            typ = re.search(r'<td class="parameter-type">(.*?)</td>', row, re.S)
            if not name or not typ:
                continue
            docs = re.search(r'<td class="parameter-docs">(.*?)</td>', row, re.S)
            doc = _strip(docs.group(1)) if docs else ""
            fields.append({
                "name": _strip(name.group(1)),
                "type": _strip(typ.group(1)),
                "deprecated": "DEPRECATED" in doc,
                "doc": doc[:200],
            })
        out[named.group(1)] = fields
    return out


def methods_of(page: str) -> list[str]:
    return re.findall(r'<div id="([^"]+)" class="methodItem">', page)


def cmd_show(args: argparse.Namespace) -> int:
    page = fetch(args.endpoint)
    print(f"# /{args.endpoint.strip('/')}/")
    print("methods:", ", ".join(methods_of(page)), "\n")
    types = complex_types(page)
    for method in args.method or methods_of(page):
        rt = request_type_of(page, method)
        print(f"=== {method}  (request type: {rt})")
        for f in types.get(rt or "", []):
            flag = " [DEPRECATED]" if f["deprecated"] else ""
            print(f"   {f['name']:32} {f['type']:16}{flag} {f['doc'][:70]}")
        print()
    return 0


def cmd_fixture(args: argparse.Namespace) -> int:
    fixture: dict[str, dict] = {}
    problems: list[str] = []

    for tool, (path, method) in sorted(TOOL_METHODS.items()):
        page = fetch(path)
        if method not in methods_of(page):
            problems.append(f"{tool}: method {method} not published on /{path}/")
            continue
        rt = request_type_of(page, method)
        fields = complex_types(page).get(rt or "", [])
        if not fields:
            problems.append(f"{tool}: no request fields resolved (type={rt})")
            continue
        # A name or type with whitespace in it is two rows parsed as one —
        # what happened silently when Omie started omitting empty docs cells.
        # Refuse to write that into the contract rather than warn about it.
        malformed = [f["name"] for f in fields if re.search(r"\s", f["name"] + f["type"]) or not f["type"]]
        if malformed:
            print(f"error: {tool}: malformed field row(s) {malformed} on /{path}/ — parser out of date", file=sys.stderr)
            return 2
        fixture[tool] = {
            "path": f"/{path.strip('/')}/",
            "call": method,
            "requestType": rt,
            "fields": {f["name"]: {"type": f["type"], "deprecated": f["deprecated"]} for f in fields},
        }

    for p in problems:
        print(f"warning: {p}", file=sys.stderr)

    payload = {
        "_comment": (
            "Generated by scripts/omie-doc.py from Omie's published API reference "
            "(https://app.omie.com.br/api/v1/<endpoint>/). Do not hand-edit — "
            "regenerate with: python3 scripts/omie-doc.py fixture --out <this file>. "
            "The contract test asserts every field a tool schema declares appears here, "
            "which is what catches invented filters and the wrong pagination spelling."
        ),
        "tools": fixture,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(fixture)} tools to {out}")
    return 1 if problems and args.strict else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    show = sub.add_parser("show", help="Dump an endpoint's methods and request fields")
    show.add_argument("endpoint", help='e.g. "geral/categorias"')
    show.add_argument("--method", action="append", help="Limit to these methods (repeatable)")
    show.set_defaults(func=cmd_show)

    fx = sub.add_parser("fixture", help="Regenerate the contract-test fixture")
    fx.add_argument("--out", required=True)
    fx.add_argument("--strict", action="store_true", help="Exit non-zero if any tool fails to resolve")
    fx.set_defaults(func=cmd_fixture)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
