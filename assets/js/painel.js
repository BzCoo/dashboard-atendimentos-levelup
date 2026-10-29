import { $, $$, el, clone, rpc, fmt, delta, isNum, toast, metaPara, frenteMeta, addDias } from './core.js?v=202610291203';
import { montarFiltros } from './filtros.js?v=202610291203';
import * as G from './charts.js?v=202610291203';

const KPIS = [
  ['atendimentos', fmt.int, 'var_atendimentos', 'pct', null],
  ['taxa_resposta', fmt.pct, 'var_taxa_resposta', 'pp', 'up'],
  ['taxa_sla', fmt.pct, 'var_taxa_sla', 'pp', 'up'],
  ['tempo_medio_min', fmt.min, 'var_tempo_medio_min', 'min', 'down'],
  ['vendas_total', fmt.int, 'var_vendas_total', 'abs', 'up'],
  ['sem_resposta', fmt.int, 'var_sem_resposta', 'abs', 'down'],
];

/* ---------- Tabelas ordenáveis ---------- */
const tabela = (table, cfg) => {
  const tbody = $('tbody', table);
  const busca = cfg.busca;
  const st = { col: cfg.sort, dir: -1 };
  let rows = [];
  const ncol = () => $$('thead th', table).length;
  const msg = (cls, texto) => { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt ' + cls, colspan: ncol() }, cls === 'fail' ? el('div', { class: 'lu-fail', text: texto }) : texto))); };
  const draw = () => {
    for (const th of $$('thead th', table)) {
      const b = $('button', th); th.removeAttribute('aria-sort');
      if (b && b.dataset.sort === st.col) th.setAttribute('aria-sort', st.dir > 0 ? 'ascending' : 'descending');
    }
    let r = rows.slice();
    const termo = busca ? busca.value.trim().toLowerCase() : '';
    if (termo) r = r.filter((x) => cfg.texto(x).toLowerCase().includes(termo));
    if (st.col) r.sort((a, b) => {
      const x = a[st.col], y = b[st.col], nx = isNum(x), ny = isNum(y);
      if (nx && ny) return (Number(x) - Number(y)) * st.dir;
      if (!nx && ny) return 1; if (nx && !ny) return -1;
      return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR') * st.dir;
    });
    if (!r.length) return msg('muted', termo ? 'Nada encontrado para “' + termo + '”.' : 'Sem dados no período.');
    const max = Math.max(1, ...r.map((x) => Number(x.atendimentos) || 0));
    tbody.replaceChildren(...r.map((x) => {
      const tr = el('tr', { 'data-key': String(x[cfg.chave]) });
      if (cfg.clique) { tr.className = 'click'; tr.tabIndex = 0; }
      if (cfg.selecionado?.(x)) tr.classList.add('sel');
      for (const [cls, render, hideSm] of cfg.cols) {
        const td = el('td', { class: [cls, hideSm ? 'hide-sm' : ''].filter(Boolean).join(' ') || null });
        render(td, x, max); tr.append(td);
      }
      return tr;
    }));
  };
  $('thead', table).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sort]'); if (!b) return;
    if (st.col === b.dataset.sort) st.dir = -st.dir; else { st.col = b.dataset.sort; st.dir = ['loja', 'vendedor'].includes(st.col) ? 1 : -1; }
    draw();
  });
  if (busca) busca.addEventListener('input', draw);
  if (cfg.clique) {
    tbody.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-key]'); if (tr) cfg.clique(tr.dataset.key); });
    tbody.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const tr = e.target.closest('tr[data-key]'); if (tr) { e.preventDefault(); cfg.clique(tr.dataset.key); } });
  }
  return {
    carregando: () => msg('sk', 'Carregando…'),
    falha: (t) => msg('fail', t || 'Falha ao carregar'),
    dados: (d) => { rows = Array.isArray(d) ? d : []; draw(); },
  };
};
const txt = (f) => (td, r) => { td.textContent = r[f] == null || r[f] === '' ? '—' : String(r[f]); };
const num = (f, fn) => (td, r) => { td.textContent = fn(r[f]); };
const dlt = (f, kind, better) => (td, r) => { const s = el('span'); delta(s, r[f], kind, better); td.append(s); };
const barra = (f) => (td, r, max) => {
  const w = el('span', { class: 'lu-cellbar' });
  const b = el('s'); b.style.width = Math.round(64 * (Number(r[f]) || 0) / max) + 'px';
  w.append(b, el('em', { text: fmt.int(r[f]) })); td.append(w);
};
const pill = (v) => el('span', { class: 'lu-pill ' + (v === 'success' ? 'ok' : v === 'failed' || v === 'error' ? 'bad' : v ? 'warn' : ''), text: v === 'success' ? 'ok' : v === 'failed' ? 'falhou' : v ? String(v) : '—' });
const comVendas = (r) => {
  if (!r) return r;
  const v = Math.max(Number(r.vendas) || 0, Number(r.vendas_etapa) || 0);
  const va = Math.max(Number(r.vendas_ant) || 0, Number(r.vendas_etapa_ant) || 0);
  return { ...r, vendas_total: v, vendas_total_ant: va, var_vendas_total: v - va };
};
const slaMeta = (metas) => (td, r) => {
  td.textContent = fmt.pct(r.taxa_sla);
  const m = metaPara(metas, r.loja_id), st = m ? frenteMeta(r.taxa_sla, m.meta_sla) : null;
  if (st) { td.classList.add('meta-' + st); td.title = 'Meta ' + fmt.pct(m.meta_sla) + (st === 'ok' ? ' · atingida' : ' · abaixo'); }
};
/* Barra de meta embaixo de um indicador */
const META_INFO = {
  meta_sla: ['taxa_sla', false, fmt.pct, 'pp'], meta_resposta: ['taxa_resposta', false, fmt.pct, 'pp'],
  meta_tempo_min: ['tempo_medio_min', true, fmt.min, 'min'], meta_custo_atend: ['custo_atend', true, fmt.brl, 'brl'],
};
export const pintarMeta = (bar, meta, valor) => {
  const [, menor, f] = META_INFO[bar.dataset.meta];
  const st = frenteMeta(valor, meta, menor);
  bar.hidden = !st; if (!st) return;
  const v = Number(valor), m = Number(meta);
  const frac = menor ? (v <= 0 ? 1 : Math.min(1, m / v)) : (m <= 0 ? 1 : Math.min(1, v / m));
  bar.className = 'lu-meta-bar ' + st;
  $('s', bar).style.width = Math.round(frac * 100) + '%';
  const falta = menor ? v - m : m - v;
  $('.txt', bar).replaceChildren('Meta ', el('b', { text: f(m) }), ' · ', st === 'ok' ? 'atingida' : (menor ? 'acima em ' : 'faltam ') + (META_INFO[bar.dataset.meta][3] === 'pp' ? fmt.num1(falta) + ' p.p.' : f(falta)));
};
const numerar = (main) => {
  let n = 0;
  for (const sec of $$('.lu-section', main)) { const b = $('.n-sec', sec); if (b && !sec.hidden) b.textContent = String(++n).padStart(2, '0'); }
};
const DIAS = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/* ---------- Página ---------- */
export const renderPainel = async (main, ctx) => {
  main.replaceChildren(clone('tpl-painel'));
  const { filtros: f, me, admin } = ctx;
  const multi = (me.lojas || []).length > 1;
  $$('[data-admin]', main).forEach((n) => { n.hidden = !admin; });
  $$('[data-multi]', main).forEach((n) => { n.hidden = !multi; });
  montarFiltros($('.slot-filtros', main), ctx, 'painel');
  const nomeLoja = f.conta ? (me.lojas.find((l) => Number(l.loja_id) === Number(f.conta)) || {}).loja : (me.lojas.length === 1 ? me.lojas[0].loja : null);
  $('.slot-escopo', main).textContent = nomeLoja ? nomeLoja : admin ? 'Todas as lojas' : 'Suas lojas';

  const lojaMeta = f.conta || (me.lojas.length === 1 ? me.lojas[0].loja_id : null);
  const meta = metaPara(ctx.metas, lojaMeta);
  numerar(main);
  const args = { p_inicio: f.inicio, p_fim: f.fim, p_conta: f.conta };
  const per = { p_inicio: f.inicio, p_fim: f.fim };

  const tbLojas = tabela($('#tb-lojas', main), {
    chave: 'loja_id', sort: 'atendimentos', busca: $('.q-lojas', main), texto: (r) => String(r.loja || ''),
    selecionado: (r) => Number(f.conta) === Number(r.loja_id),
    clique: (k) => ctx.trocar({ conta: Number(f.conta) === Number(k) ? null : Number(k) }),
    cols: [['txt name', txt('loja')], [null, barra('atendimentos')], ['mono', dlt('var_atendimentos', 'pct', null)],
      [null, num('taxa_resposta', fmt.pct), true], [null, slaMeta(ctx.metas)], ['mono', dlt('var_taxa_sla', 'pp', 'up'), true],
      [null, num('tempo_medio_min', fmt.num1)], [null, num('vendas_total', fmt.int), true]],
  });
  const tbVend = tabela($('#tb-vend', main), {
    chave: 'chave', sort: 'atendimentos', busca: $('.q-vend', main), texto: (r) => String(r.vendedor || '') + ' ' + String(r.loja || ''),
    cols: [['txt name', txt('vendedor')], ['txt muted', txt('loja'), true], [null, barra('atendimentos')], ['mono', dlt('var_atendimentos', 'pct', null), true],
      [null, num('taxa_resposta', fmt.pct)], [null, num('taxa_sla', fmt.pct)], [null, num('tempo_medio_min', fmt.num1)], [null, num('vendas_total', fmt.int), true]],
  });
  const tbAuto = tabela($('#tb-auto', main), {
    chave: 'loja_id', sort: null, texto: (r) => String(r.loja || ''),
    cols: [['txt name', txt('loja')], ['txt', (td, r) => td.append(pill(r.sync_status))], ['mono', (td, r) => { td.textContent = fmt.dt(r.ultima_carga); }],
      ['txt', (td, r) => { if (r.relatorio_ativo === false) { td.textContent = 'desligado'; td.classList.add('muted'); } else td.append(pill(r.relatorio_status)); }],
      ['mono', (td, r) => { td.textContent = fmt.dt(r.ultimo_relatorio); }],
      ['mono', (td, r) => { td.textContent = isNum(r.dia_envio) ? DIAS[Number(r.dia_envio)] + ' ' + (isNum(r.hora_envio) ? Number(r.hora_envio) + 'h' : '') : '—'; }, true],
      ['txt wrap muted', (td, r) => { td.textContent = r.erro ? String(r.erro) : '—'; }, true]],
  });
  const tbInv = tabela($('#tb-inv', main), {
    chave: 'cliente_id', sort: 'investimento', texto: (r) => String(r.empresa || ''),
    cols: [['txt name', (td, r) => {
      td.append(el('div', { text: r.empresa || '—' }));
      const sub = [Number(r.subcontas) > 1 ? r.subcontas + ' subcontas' : null, r.tem_dados ? null : 'sem dados do Meta no período'].filter(Boolean).join(' · ');
      if (sub) td.append(el('div', { class: 'muted', style: 'font-weight:400;font-size:12px', text: sub, title: (r.subcontas_nomes || []).join(', ') }));
    }], [null, (td, r) => { td.textContent = r.tem_dados ? fmt.brl(r.investimento) : '—'; }], ['mono', dlt('var_investimento', 'pct', null), true],
      [null, num('atendimentos', fmt.int)], [null, (td, r) => {
        td.textContent = fmt.brl(r.custo_atend);
        const st = frenteMeta(r.custo_atend, meta?.meta_custo_atend, true); if (st) td.classList.add('meta-' + st);
      }], [null, num('vendas', fmt.int), true], [null, num('custo_venda', fmt.brl), true]],
  });
  const tbAds = tabela($('#tb-ads', main), {
    chave: 'chave', sort: 'leads', busca: $('.q-ads', main), texto: (r) => String(r.anuncio || '') + ' ' + String(r.veiculo || ''),
    cols: [['txt name wrap', (td, r) => {
      td.append(el('div', { text: r.anuncio || '—' }));
      const sub = [r.veiculo && !String(r.anuncio || '').toUpperCase().startsWith(r.veiculo) ? r.veiculo : null, isNum(r.preco) && Number(r.preco) > 0 ? fmt.brl0(r.preco) : null, Number(r.lojas) > 1 ? r.lojas + ' lojas' : null].filter(Boolean).join(' · ');
      if (sub) td.append(el('div', { class: 'muted', style: 'font-weight:400;font-size:12px', text: sub }));
    }], [null, num('leads', fmt.int)], [null, num('taxa_resposta', fmt.pct), true],
      [null, (td, r) => { td.textContent = fmt.int(r.avancaram) + (Number(r.leads) ? ' · ' + fmt.pct(r.taxa_avanco) : ''); }],
      [null, num('vendas', fmt.int), true], ['col-inv', num('custo_lead', fmt.brl)]],
  });
  tbLojas.carregando(); tbVend.carregando(); tbAuto.carregando(); tbInv.carregando(); tbAds.carregando();
  const navInv = $$('#nav-secoes [data-inv]');

  const box = (id) => $('#' + id, main);
  const pronto = (b) => b.classList.remove('sk');
  const desenhar = { spark: null, volume: null, sla: null, etapas: null, horarios: null };

  const tarefas = {
    lojas: rpc('atend_lojas').then((r) => {
      const carga = r?.[0]?.ultima_carga;
      $('.slot-carga', main).textContent = carga ? fmt.dt(carga) : '—';
      // Carga: 01h e de hora em hora das 8h às 22h. Avisa quando o período chega até dados ainda não carregados.
      if (!carga) return;
      const sp = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
      const diaCarga = sp(new Date(carga)), hojeSp = sp(new Date());
      const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(carga));
      if (f.fim >= diaCarga) {
        const av = $('.slot-aviso-carga', main);
        if (diaCarga === hojeSp) av.replaceChildren(el('b', { text: 'Hoje ainda está em andamento. ' }), 'Os dados vão até ' + hora + '; o painel é atualizado de hora em hora, das 8h às 22h.');
        else av.replaceChildren(el('b', { text: 'Período inclui dias ainda não carregados. ' }), 'Os dados vão até ' + fmt.dm(diaCarga) + ' às ' + hora + '; o restante entra na próxima atualização.');
        av.hidden = false;
      }
    }),
    kpis: rpc('atend_kpis', args).then((rows) => preencherKpis(main, comVendas(rows?.[0]), nomeLoja, meta)),
    investimento: rpc('atend_investimento', args).then((d) => preencherInv(main, d, meta, tbInv, navInv)),
    anuncios: rpc('atend_anuncios', args).then((d) => {
      const nota = $('.slot-anuncios-nota', main);
      if (d && Number(d.leads_com_anuncio)) nota.textContent = fmt.int(d.leads_com_anuncio) + ' leads chegaram pelo botão do anúncio, vindos de ' + fmt.int(d.anuncios_distintos) + ' anúncios e ' + fmt.int(d.veiculos_distintos) + ' veículos. “Avançaram” = chegaram a condição, simulação, visita, negociação ou venda.';
      const semInv = !d?.investimento_visivel;
      $('#tb-ads', main).classList.toggle('sem-inv', semInv);
      if (semInv) $('.slot-ads-sub', main).textContent = 'Ordenado por leads. Clique no título da coluna para reordenar.';
      tbAds.dados(d?.anuncios || []);
      pronto(box('ch-veiculos')); desenhar.veiculos = () => G.veiculos(box('ch-veiculos'), d?.veiculos || []); desenhar.veiculos();
    }),
    serie: rpc('atend_serie', args).then((s) => {
      desenhar.spark = () => G.spark(box('ch-spark'), s); desenhar.volume = () => G.volume(box('ch-volume'), s); desenhar.sla = () => G.sla(box('ch-sla'), s);
      ['ch-spark', 'ch-volume', 'ch-sla'].forEach((i) => pronto(box(i)));
      desenhar.spark(); desenhar.volume(); desenhar.sla();
    }),
    etapas: rpc('atend_etapas', args).then((r) => { pronto(box('ch-etapas')); desenhar.etapas = () => G.etapas(box('ch-etapas'), r); desenhar.etapas(); }),
    horarios: rpc('atend_horarios', args).then((r) => { pronto(box('ch-horarios')); desenhar.horarios = () => G.horarios(box('ch-horarios'), r); desenhar.horarios(); }),
    vendedores: rpc('atend_vendedores', args).then((r) => tbVend.dados((r || []).map(comVendas))),
  };
  if (multi) tarefas.por_loja = rpc('atend_por_loja', per).then((r) => tbLojas.dados((r || []).map(comVendas)));
  if (admin) tarefas.automacao = rpc('atend_automacao').then((r) => tbAuto.dados(r));

  const falhas = { serie: ['ch-spark', 'ch-volume', 'ch-sla'], etapas: ['ch-etapas'], horarios: ['ch-horarios'], anuncios: ['ch-veiculos'] };
  const resultados = await Promise.allSettled(Object.values(tarefas));
  Object.keys(tarefas).forEach((k, i) => {
    if (resultados[i].status !== 'rejected') return;
    const m = resultados[i].reason?.message;
    if (falhas[k]) falhas[k].forEach((id) => { pronto(box(id)); G.falha(box(id)); });
    if (k === 'vendedores') tbVend.falha(m); if (k === 'por_loja') tbLojas.falha(m); if (k === 'automacao') tbAuto.falha(m); if (k === 'investimento') tbInv.falha(m); if (k === 'anuncios') tbAds.falha(m);
    if (k === 'kpis') { $('#resumo', main).textContent = m || 'Não foi possível carregar os indicadores.'; }
  });
  const erro = resultados.find((r) => r.status === 'rejected');
  if (erro) toast(erro.reason?.message || 'Parte do painel não carregou.', true);

  // Redesenha os gráficos quando a largura muda
  let w = main.clientWidth, t;
  const ro = new ResizeObserver(() => {
    if (Math.abs(main.clientWidth - w) < 8) return; w = main.clientWidth;
    clearTimeout(t); t = setTimeout(() => Object.values(desenhar).forEach((fn) => fn && fn()), 120);
  });
  ro.observe(main);
  return () => ro.disconnect();
};

const preencherInv = (main, d, meta, tb, navInv) => {
  const sec = $('#investimento', main);
  const t = d?.total;
  const visivel = !!t && Number(t.empresas) > 0;
  sec.hidden = !visivel; navInv.forEach((n) => { n.hidden = !visivel; });
  numerar(main);
  if (!visivel) return;
  const put = (c, v) => { const n = $('.i-' + c, sec); if (n) { n.classList.remove('sk'); n.textContent = v; } };
  put('investimento', fmt.brl(t.investimento)); put('investimento_ant', fmt.brl(t.investimento_ant));
  put('custo_atend', fmt.brl(t.custo_atend)); put('custo_atend_ant', fmt.brl(t.custo_atend_ant));
  put('custo_venda', fmt.brl(t.custo_venda)); put('vendas', fmt.int(t.vendas)); put('atendimentos', fmt.int(t.atendimentos));
  delta($('.di-var_investimento', sec), t.var_investimento, 'pct', null);
  delta($('.di-var_custo_atend', sec), t.var_custo_atend, 'brl', 'down');
  const bar = $('[data-meta=meta_custo_atend]', sec); if (bar) pintarMeta(bar, meta?.meta_custo_atend, t.custo_atend);
  const notas = ['Investimento do Meta Ads da empresa ÷ novos atendimentos de todas as subcontas dela.'];
  if (Number(t.empresas_sem_dados)) notas.push('Sem dados do Meta no período (fora do cálculo): ' + (t.nomes_sem_dados || []).join(', ') + '.');
  if (Number(d.empresas_ocultas)) notas.push(d.empresas_ocultas + (d.empresas_ocultas === 1 ? ' empresa não aparece' : ' empresas não aparecem') + ' porque o investimento é da empresa inteira e seu acesso cobre só parte das lojas dela.');
  $('.slot-inv-nota', sec).textContent = notas.join(' ');
  const linhas = d.empresas || [];
  $('.slot-inv-tabela', sec).hidden = linhas.length <= 1 && Number(linhas[0]?.subcontas || 0) <= 1;
  tb.dados(linhas);
};

const preencherKpis = (main, r, nomeLoja, meta) => {
  const vEt = $('.k-vendas_etapa', main); if (vEt) vEt.textContent = r ? fmt.int(r.vendas_etapa) : '—';
  const vG = $('.k-vendas', main); if (vG) vG.textContent = r ? fmt.int(r.vendas) : '—';
  for (const bar of $$('.lu-meta-bar[data-meta]', $('#visao-geral', main) || main)) {
    if (bar.dataset.meta === 'meta_custo_atend') continue;
    pintarMeta(bar, meta?.[bar.dataset.meta], r?.[META_INFO[bar.dataset.meta][0]]);
  }
  for (const [k, fn, d, kind, better] of KPIS) {
    const v = $('.k-' + k, main); if (v) { v.classList.remove('sk'); v.textContent = r ? fn(r[k]) : '—'; }
    const dd = $('.d-' + k, main); if (dd) delta(dd, r ? r[d] : null, kind, better);
  }
  for (const [k, fn] of [['atendimentos_ant', fmt.int], ['respondidos', fmt.int], ['tempo_mediano_min', fmt.min], ['sla_min', fmt.int]]) {
    const v = $('.k-' + k, main); if (v) v.textContent = r ? fn(r[k]) : '—';
  }
  $('.slot-comp', main).textContent = r ? fmt.dm(r.de_ant) + ' a ' + fmt.dmy(r.ate_ant) : '—';
  const p = $('#resumo', main);
  p.replaceChildren();
  if (!r) { p.textContent = 'Sem dados para o período.'; return; }
  const b = (t) => el('b', { text: t });
  p.append((nomeLoja ? nomeLoja + ', de ' : 'De ') + fmt.dmy(r.de) + ' a ' + fmt.dmy(r.ate) + ': ', b(fmt.int(r.atendimentos)), ' novos atendimentos');
  if (isNum(r.var_atendimentos)) {
    const n = Number(r.var_atendimentos);
    p.append(' (', el('span', { class: n > 0 ? 'up' : n < 0 ? 'down' : '', text: fmt.sinal(n, 'pct') }), ' vs. período anterior)');
  }
  if (isNum(r.taxa_sla)) p.append(', ', b(fmt.pct(r.taxa_sla)), ' das respostas dentro do SLA');
  if (Number(r.sem_resposta) > 0) p.append(' e ', b(fmt.int(r.sem_resposta)), ' leads ainda sem resposta');
  p.append('.');
};
