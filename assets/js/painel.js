import { $, $$, el, clone, rpc, fmt, delta, isNum, toast } from './core.js?v=202610271521';
import { montarFiltros } from './filtros.js?v=202610271521';
import * as G from './charts.js?v=202610271521';

const KPIS = [
  ['atendimentos', fmt.int, 'var_atendimentos', 'pct', null],
  ['taxa_resposta', fmt.pct, 'var_taxa_resposta', 'pp', 'up'],
  ['taxa_sla', fmt.pct, 'var_taxa_sla', 'pp', 'up'],
  ['tempo_medio_min', fmt.min, 'var_tempo_medio_min', 'min', 'down'],
  ['vendas', fmt.int, 'var_vendas', 'abs', 'up'],
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
const DIAS = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/* ---------- Página ---------- */
export const renderPainel = async (main, ctx) => {
  main.replaceChildren(clone('tpl-painel'));
  const { filtros: f, me, admin } = ctx;
  const multi = (me.lojas || []).length > 1;
  $$('[data-admin]', main).forEach((n) => { n.hidden = !admin; });
  $$('[data-multi]', main).forEach((n) => { n.hidden = !multi; });
  if (!multi) $('.n-vend', main).textContent = '03';
  montarFiltros($('.slot-filtros', main), ctx, 'painel');
  const nomeLoja = f.conta ? (me.lojas.find((l) => Number(l.loja_id) === Number(f.conta)) || {}).loja : (me.lojas.length === 1 ? me.lojas[0].loja : null);
  $('.slot-escopo', main).textContent = nomeLoja ? nomeLoja : admin ? 'Todas as lojas' : 'Suas lojas';

  const args = { p_inicio: f.inicio, p_fim: f.fim, p_conta: f.conta };
  const per = { p_inicio: f.inicio, p_fim: f.fim };

  const tbLojas = tabela($('#tb-lojas', main), {
    chave: 'loja_id', sort: 'atendimentos', busca: $('.q-lojas', main), texto: (r) => String(r.loja || ''),
    selecionado: (r) => Number(f.conta) === Number(r.loja_id),
    clique: (k) => ctx.trocar({ conta: Number(f.conta) === Number(k) ? null : Number(k) }),
    cols: [['txt name', txt('loja')], [null, barra('atendimentos')], ['mono', dlt('var_atendimentos', 'pct', null)],
      [null, num('taxa_resposta', fmt.pct), true], [null, num('taxa_sla', fmt.pct)], ['mono', dlt('var_taxa_sla', 'pp', 'up'), true],
      [null, num('tempo_medio_min', fmt.num1)], [null, num('vendas', fmt.int), true]],
  });
  const tbVend = tabela($('#tb-vend', main), {
    chave: 'chave', sort: 'atendimentos', busca: $('.q-vend', main), texto: (r) => String(r.vendedor || '') + ' ' + String(r.loja || ''),
    cols: [['txt name', txt('vendedor')], ['txt muted', txt('loja'), true], [null, barra('atendimentos')], ['mono', dlt('var_atendimentos', 'pct', null), true],
      [null, num('taxa_resposta', fmt.pct)], [null, num('taxa_sla', fmt.pct)], [null, num('tempo_medio_min', fmt.num1)], [null, num('vendas', fmt.int), true]],
  });
  const tbAuto = tabela($('#tb-auto', main), {
    chave: 'loja_id', sort: null, texto: (r) => String(r.loja || ''),
    cols: [['txt name', txt('loja')], ['txt', (td, r) => td.append(pill(r.sync_status))], ['mono', (td, r) => { td.textContent = fmt.dt(r.ultima_carga); }],
      ['txt', (td, r) => { if (r.relatorio_ativo === false) { td.textContent = 'desligado'; td.classList.add('muted'); } else td.append(pill(r.relatorio_status)); }],
      ['mono', (td, r) => { td.textContent = fmt.dt(r.ultimo_relatorio); }],
      ['mono', (td, r) => { td.textContent = isNum(r.dia_envio) ? DIAS[Number(r.dia_envio)] + ' ' + (isNum(r.hora_envio) ? Number(r.hora_envio) + 'h' : '') : '—'; }, true],
      ['txt wrap muted', (td, r) => { td.textContent = r.erro ? String(r.erro) : '—'; }, true]],
  });
  tbLojas.carregando(); tbVend.carregando(); tbAuto.carregando();

  const box = (id) => $('#' + id, main);
  const pronto = (b) => b.classList.remove('sk');
  const desenhar = { spark: null, volume: null, sla: null, etapas: null, horarios: null };

  const tarefas = {
    lojas: rpc('atend_lojas').then((r) => { $('.slot-carga', main).textContent = r?.[0] ? fmt.dt(r[0].ultima_carga) : '—'; }),
    kpis: rpc('atend_kpis', args).then((rows) => preencherKpis(main, rows?.[0], nomeLoja)),
    serie: rpc('atend_serie', args).then((s) => {
      desenhar.spark = () => G.spark(box('ch-spark'), s); desenhar.volume = () => G.volume(box('ch-volume'), s); desenhar.sla = () => G.sla(box('ch-sla'), s);
      ['ch-spark', 'ch-volume', 'ch-sla'].forEach((i) => pronto(box(i)));
      desenhar.spark(); desenhar.volume(); desenhar.sla();
    }),
    etapas: rpc('atend_etapas', args).then((r) => { pronto(box('ch-etapas')); desenhar.etapas = () => G.etapas(box('ch-etapas'), r); desenhar.etapas(); }),
    horarios: rpc('atend_horarios', args).then((r) => { pronto(box('ch-horarios')); desenhar.horarios = () => G.horarios(box('ch-horarios'), r); desenhar.horarios(); }),
    vendedores: rpc('atend_vendedores', args).then((r) => tbVend.dados(r)),
  };
  if (multi) tarefas.por_loja = rpc('atend_por_loja', per).then((r) => tbLojas.dados(r));
  if (admin) tarefas.automacao = rpc('atend_automacao').then((r) => tbAuto.dados(r));

  const falhas = { serie: ['ch-spark', 'ch-volume', 'ch-sla'], etapas: ['ch-etapas'], horarios: ['ch-horarios'] };
  const resultados = await Promise.allSettled(Object.values(tarefas));
  Object.keys(tarefas).forEach((k, i) => {
    if (resultados[i].status !== 'rejected') return;
    const m = resultados[i].reason?.message;
    if (falhas[k]) falhas[k].forEach((id) => { pronto(box(id)); G.falha(box(id)); });
    if (k === 'vendedores') tbVend.falha(m); if (k === 'por_loja') tbLojas.falha(m); if (k === 'automacao') tbAuto.falha(m);
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

const preencherKpis = (main, r, nomeLoja) => {
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
