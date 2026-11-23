/* Central LevelUp › Tráfego › Resultados (Dev e Gestor): gasto e resultado por cliente e ranking de anúncios de todas as contas.
   Gasto e conversas vêm do Meta; leads, avanço e venda vêm do CRM (lead ligado ao anúncio pela mensagem de origem). */
import { $, $$, el, clone, rpc, fmt, toast } from './core.js?v=202611231241';

const MIN_GASTO_SEM_RESULTADO = 50;   // R$ gastos no período sem nenhuma conversa nem lead
const div = (a, b) => (Number(b) > 0 ? Number(a) / Number(b) : null);
const varPct = (a, b) => (Number(b) > 0 ? (100 * (Number(a) - Number(b))) / Number(b) : null);
// modo 'up' = subir é bom (conversas, leads); 'neutro' = só mostra a variação (investimento)
const delta = (v, modo = 'up') => {
  if (v === null || !Number.isFinite(v)) return null;
  const cls = modo === 'neutro' || Math.abs(v) < 0.5 ? '' : v > 0 ? 'good' : 'bad';
  return el('span', { class: 'lu-delta ' + cls, text: fmt.sinal(v, 'pct') });
};
const semLeads = (c) => !c.tem_crm || (Number(c.leads) + Number(c.leads_ant) === 0);

export const renderTrafegoResultados = async (main) => {
  main.replaceChildren(clone('tpl-trafego-res'));
  let dias = 7, dados = null, aba = 'melhores';
  const selCli = $('.f-res-cli', main), q = $('.q-res', main);

  const tiles = () => {
    const cs = dados.clientes;
    const soma = (k) => cs.reduce((s, c) => s + Number(c[k] || 0), 0);
    const comCrm = cs.filter((c) => !semLeads(c));
    const gCrm = comCrm.reduce((s, c) => s + Number(c.gasto || 0), 0), lCrm = comCrm.reduce((s, c) => s + Number(c.leads || 0), 0);
    const tile = (rotulo, valor, sub, d) => el('div', { class: 'lu-shell lu-kpi' }, el('div', { class: 'lu-core' },
      el('span', { class: 'lu-kpi-label', text: rotulo }), el('span', { class: 'lu-kpi-value', text: valor }),
      el('div', { class: 'lu-kpi-foot' }, d, el('span', { text: sub }))));
    $('.slot-res-kpis', main).replaceChildren(
      tile('Investimento', fmt.brl0(soma('gasto')), 'vs. ' + fmt.brl0(soma('gasto_ant')), delta(varPct(soma('gasto'), soma('gasto_ant')), 'neutro')),
      tile('Conversas no Meta', fmt.int(soma('conversas')), 'custo de ' + fmt.brl(div(soma('gasto'), soma('conversas'))) + ' cada', delta(varPct(soma('conversas'), soma('conversas_ant')))),
      tile('Leads do anúncio no CRM', fmt.int(lCrm), comCrm.length + ' clientes com origem do anúncio ligada', delta(varPct(lCrm, comCrm.reduce((s, c) => s + Number(c.leads_ant || 0), 0)))),
      tile('Custo por lead', fmt.brl(div(gCrm, lCrm)), 'só clientes com origem ligada', null),
      tile('Avançaram no funil', fmt.int(soma('avancaram')), fmt.int(soma('vendas')) + ' vendas', null));
  };

  const tabelaClientes = () => {
    const linhas = dados.clientes.map((c) => {
      const sl = semLeads(c);
      return el('tr', {},
        el('td', { class: 'txt name' }, el('b', { text: c.cliente })),
        el('td', { class: 'num', 'data-label': 'Investimento' }, el('span', { text: fmt.brl0(c.gasto) }), delta(varPct(c.gasto, c.gasto_ant), 'neutro')),
        el('td', { class: 'num', 'data-label': 'Conversas' }, el('span', { text: fmt.int(c.conversas) }), delta(varPct(c.conversas, c.conversas_ant))),
        el('td', { class: 'num', 'data-label': 'Custo/conversa', text: fmt.brl(div(c.gasto, c.conversas)) }),
        el('td', { class: 'num', 'data-label': 'Leads CRM', title: sl ? 'Este cliente ainda não tem a origem do anúncio ligada no CRM' : '', text: sl ? '—' : fmt.int(c.leads) }),
        el('td', { class: 'num hide-sm', 'data-label': 'Avançaram', text: sl ? '—' : fmt.int(c.avancaram) }),
        el('td', { class: 'num hide-sm', 'data-label': 'Vendas', text: sl ? '—' : fmt.int(c.vendas) }),
        el('td', { class: 'num', 'data-label': 'Custo/lead', text: sl ? '—' : fmt.brl(div(c.gasto, c.leads)) }));
    });
    $('#tb-res-cli tbody', main).replaceChildren(...(linhas.length ? linhas : [el('tr', {}, el('td', { class: 'txt muted', colspan: 8, text: 'Sem gasto no período.' }))]));
  };

  const tabelaAnuncios = () => {
    const cli = selCli.value, t = q.value.trim().toLowerCase();
    let lista = dados.anuncios.filter((a) => (!cli || String(a.cliente_id) === cli) && (!t || [a.anuncio, a.cliente].join(' ').toLowerCase().includes(t)));
    const semRes = (a) => Number(a.gasto) >= MIN_GASTO_SEM_RESULTADO && Number(a.conversas) === 0 && Number(a.leads) === 0;
    const nSem = lista.filter(semRes).length;
    if (aba === 'sem') lista = lista.filter(semRes).sort((x, y) => y.gasto - x.gasto);
    else if (aba === 'melhores') lista = lista.filter((a) => Number(a.leads) > 0 || Number(a.conversas) > 0)
      .sort((x, y) => y.avancaram - x.avancaram || y.leads - x.leads || (div(x.gasto, x.conversas) ?? 1e9) - (div(y.gasto, y.conversas) ?? 1e9));
    $$('.res-aba', main).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.aba === aba)));
    $('.res-aba[data-aba="sem"] em', main).textContent = nSem;
    const linhas = lista.slice(0, 150).map((a) => el('tr', { class: semRes(a) ? 'res-sem' : '' },
      el('td', { class: 'txt name' }, el('b', { class: 'res-ad', title: a.anuncio, text: a.anuncio }),
        el('small', { class: 'muted res-cli', text: (a.cliente || '—') + (a.status && a.status !== 'ACTIVE' ? ' · ' + a.status.toLowerCase() : '') })),
      el('td', { class: 'num', 'data-label': 'Investimento', text: fmt.brl(a.gasto) }),
      el('td', { class: 'num', 'data-label': 'Conversas', text: fmt.int(a.conversas) }),
      el('td', { class: 'num hide-sm', 'data-label': 'Custo/conversa', text: fmt.brl(div(a.gasto, a.conversas)) }),
      el('td', { class: 'num', 'data-label': 'Leads CRM', text: fmt.int(a.leads) }),
      el('td', { class: 'num', 'data-label': 'Avançaram', text: fmt.int(a.avancaram) }),
      el('td', { class: 'num hide-sm', 'data-label': 'Vendas', text: fmt.int(a.vendas) })));
    $('#tb-res-ad tbody', main).replaceChildren(...(linhas.length ? linhas : [el('tr', {}, el('td', { class: 'txt muted', colspan: 7,
      text: aba === 'sem' ? 'Nenhum anúncio gastou ' + fmt.brl0(MIN_GASTO_SEM_RESULTADO) + ' ou mais sem trazer conversa nem lead. 👌' : 'Nenhum anúncio encontrado.' }))]));
    $('.slot-res-mais', main).textContent = lista.length > 150 ? 'Mostrando 150 de ' + lista.length + '. Filtre por cliente para ver o resto.' : '';
  };

  const avisos = () => {
    const av = [];
    if (dados.ult_dia_anuncios && dados.ult_dia_anuncios < dados.ate) av.push('Os números por anúncio vão até ' + fmt.dm(dados.ult_dia_anuncios) + '; a sincronização do Meta ainda está completando os dias que faltavam.');
    if (dados.ult_dia_contas && dados.ult_dia_contas < dados.ate) av.push('O investimento por conta vai até ' + fmt.dm(dados.ult_dia_contas) + '.');
    const p = $('.slot-res-aviso', main); p.hidden = !av.length; p.textContent = av.join(' ');
    $('.slot-res-periodo', main).textContent = fmt.dm(dados.de) + ' a ' + fmt.dm(dados.ate) + ' · comparado com ' + fmt.dm(dados.de_ant) + ' a ' + fmt.dm(dados.ate_ant);
  };

  const carregar = async () => {
    $('.slot-res-periodo', main).textContent = 'Carregando…';
    try {
      dados = await rpc('atend_trafego_resultados', { p_dias: dias });
      const antes = selCli.value;
      const clis = [...new Map(dados.anuncios.filter((a) => a.cliente_id).map((a) => [String(a.cliente_id), a.cliente])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      selCli.replaceChildren(el('option', { value: '', text: 'Todos os clientes' }), ...clis.map(([id, n]) => el('option', { value: id, text: n })));
      if (clis.some(([id]) => id === antes)) selCli.value = antes;
      avisos(); tiles(); tabelaClientes(); tabelaAnuncios();
    } catch (e) {
      toast(e.message, true);
      $('#tb-res-cli tbody', main).replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 8 }, el('div', { class: 'lu-fail', text: e.message }))));
    }
  };

  $$('input[name="res-dias"]', main).forEach((r) => r.addEventListener('change', () => { dias = Number(r.value); carregar(); }));
  $$('.res-aba', main).forEach((b) => b.addEventListener('click', () => { aba = b.dataset.aba; tabelaAnuncios(); }));
  selCli.addEventListener('change', tabelaAnuncios);
  q.addEventListener('input', tabelaAnuncios);
  await carregar();
};
