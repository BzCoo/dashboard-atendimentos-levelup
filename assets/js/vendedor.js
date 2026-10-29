import { $, $$, clone, rpc, fmt, delta, isNum, irPara, rotuloComp } from './core.js?v=202610291301';
import { montarFiltros } from './filtros.js?v=202610291301';
import { tabela, celulasLead } from './painel.js?v=202610291301';
import * as G from './charts.js?v=202610291301';

/* Página de detalhe de um vendedor: #/vendedor?v=<loja:usuario>&de=&ate= */
export const renderVendedor = async (main, ctx, chave) => {
  main.replaceChildren(clone('tpl-vendedor'));
  const f = ctx.filtros;
  montarFiltros($('.slot-filtros', main), ctx, 'vendedor');
  $('.slot-filtros .lu-field.loja', main)?.setAttribute('hidden', '');
  const voltar = $('[data-voltar]', main);
  voltar.addEventListener('click', (e) => { e.preventDefault(); irPara('painel', f, 'vendedores'); });
  if (!chave) { $('.slot-nome', main).textContent = 'Vendedor não informado'; return; }

  const tb = tabela($('#tb-vleads', main), { chave: 'chave_lead', sort: 'primeira_msg', texto: (r) => r.nome, cols: celulasLead(false) });
  tb.carregando();
  const comp = f.comparar || 'anterior';
  if (comp !== 'anterior') $('.slot-vs', main).textContent = 'vs. ' + rotuloComp(comp);

  let d;
  try { d = await rpc('atend_vendedor', { p_inicio: f.inicio, p_fim: f.fim, p_chave: chave, p_comparar: comp }); }
  catch (e) { $('.slot-nome', main).textContent = 'Não foi possível abrir'; $('.slot-sub', main).textContent = e.message; tb.falha(e.message); return; }

  document.title = d.vendedor + ' · Dashboard de Atendimentos · Level Up';
  $('.slot-nome', main).textContent = d.vendedor;
  $('.slot-loja', main).textContent = d.loja || '';
  $('.slot-sub', main).textContent = fmt.dmy(d.de) + ' a ' + fmt.dmy(d.ate) + ' · comparado com ' + fmt.dm(d.de_ant) + ' a ' + fmt.dmy(d.ate_ant);

  const a = d.atual || {}, b = d.anterior || {}, lj = d.loja_media || {};
  const vt = (x) => Math.max(Number(x.vendas) || 0, Number(x.vendas_etapa) || 0);
  const linhas = [
    ['atendimentos', fmt.int, (Number(a.atendimentos) || 0) && b.atendimentos ? 100 * (a.atendimentos - b.atendimentos) / b.atendimentos : null, 'pct', null],
    ['taxa_resposta', fmt.pct, isNum(a.taxa_resposta) && isNum(b.taxa_resposta) ? a.taxa_resposta - b.taxa_resposta : null, 'pp', 'up'],
    ['taxa_sla', fmt.pct, isNum(a.taxa_sla) && isNum(b.taxa_sla) ? a.taxa_sla - b.taxa_sla : null, 'pp', 'up'],
    ['tempo_medio_min', fmt.min, isNum(a.tempo_medio_min) && isNum(b.tempo_medio_min) ? a.tempo_medio_min - b.tempo_medio_min : null, 'min', 'down'],
  ];
  for (const [k, fn, dv, kind, better] of linhas) {
    const v = $('.v-' + k, main); v.classList.remove('sk'); v.textContent = fn(a[k]);
    delta($('.dv-' + k, main), isNum(dv) ? Math.round(dv * 10) / 10 : null, kind, better);
    const m = $('.m-' + k, main);
    // Média da loja só faz sentido quando há mais de um vendedor
    if (m && Number(lj.vendedores) > 1 && isNum(lj[k])) m.textContent = 'loja: ' + fn(lj[k]);
  }
  const vv = $('.v-vendas_total', main); vv.classList.remove('sk'); vv.textContent = fmt.int(vt(a));
  delta($('.dv-vendas_total', main), vt(a) - vt(b), 'abs', 'up');

  // Gráficos (mesmo formato da série do painel; sem linha do período anterior)
  const serie = (d.serie || []).map((s, i) => ({ ...s, idx: i, periodo: 'atual' }));
  const etapas = (d.etapas || []).map((e) => ({ etapa: e.etapa, leads: e.leads, leads_ant: 0 }));
  const box = (id) => $('#' + id, main);
  const desenhar = () => {
    ['chv-volume', 'chv-sla', 'chv-etapas'].forEach((id) => box(id).classList.remove('sk'));
    if (serie.length) { G.volume(box('chv-volume'), serie); G.sla(box('chv-sla'), serie); }
    else { G.vazio(box('chv-volume'), 'Nenhum lead no período.'); G.vazio(box('chv-sla'), 'Nenhum lead no período.'); }
    G.etapas(box('chv-etapas'), etapas);
  };
  desenhar();
  $('.slot-leads-total', main).textContent = fmt.int(d.leads_total) + ' leads novos no período' + (Number(d.leads_total) > (d.leads || []).length ? ' (mostrando os 200 mais recentes)' : '') + '. Verde: respondido dentro do SLA.';
  tb.dados((d.leads || []).map((l, i) => ({ ...l, chave_lead: String(i) })));

  let w = main.clientWidth, t;
  const ro = new ResizeObserver(() => { if (Math.abs(main.clientWidth - w) < 8) return; w = main.clientWidth; clearTimeout(t); t = setTimeout(desenhar, 120); });
  ro.observe(main);
  return () => ro.disconnect();
};
