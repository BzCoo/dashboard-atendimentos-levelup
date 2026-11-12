import { $, $$, el, fmt, rpc, intervalo } from './core.js?v=202611121216';
import { chegada as grafico, falha } from './charts.js?v=202611121216';

/* Cartão "Horário de chegada dos leads": faixa de horário com minuto (entre / depois / antes / às) e dias da semana.
   Os números vêm de atend_chegada (banco), para qualquer loja ou todas. */

const NOME_DIAS = { todos: '', uteis: ', de segunda a sexta', sab: ', aos sábados', dom: ', aos domingos' };
const PADRAO = { modo: 'entre', de: '', ate: '', dias: 'todos', fontes: [] };
const nomeFonte = (f) => f || 'Sem fonte';
const rede = (f) => (/insta/i.test(f) ? 'ig' : /face|fb/i.test(f) ? 'fb' : '');
const hm = (t) => { if (!t) return ''; const [h, m] = t.split(':'); return Number(h) + 'h' + (m && m !== '00' ? m : ''); };

export const montarChegada = (main, { tabela, celulasLead, filtros, multi }) => {
  const card = $('.lu-cheg', main);
  if (!card) return { carregar() {} };
  const sModo = $('.c-modo', card), iDe = $('.c-de', card), iAte = $('.c-ate', card), sDias = $('.c-dias', card);
  const box = $('#ch-chegada', card), boxLojas = $('.lu-cheg-lojas', card);
  const iD1 = $('.c-d1', card), iD2 = $('.c-d2', card), erro = $('.lu-cheg-erro', card);
  const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  iD1.max = hojeSP; iD2.max = hojeSP;
  // Datas do cartão: começam no período do painel e podem ser trocadas só aqui
  let datas = { de: filtros.inicio, ate: filtros.fim };

  let st = { ...PADRAO };
  try { st = { ...PADRAO, ...JSON.parse(localStorage.getItem('lu-chegada2') || '{}') }; } catch { /* sem storage */ }
  if (!Array.isArray(st.fontes)) st.fontes = [];
  let dados = null, pedido = 0, timer = null;

  // Lista: no "Todas as lojas" entra a coluna da loja
  const cols = celulasLead(true);
  if (multi) cols.splice(2, 0, ['txt muted', (td, r) => { td.textContent = r.loja || '—'; }]);
  // Fonte do lead (origem no GHL, ou a rede do anúncio); só aparece quando existe
  cols.splice(multi ? 3 : 2, 0, ['txt', (td, r) => {
    if (!r.fonte) { td.textContent = '—'; td.classList.add('muted'); td.dataset.csv = ''; return; }
    td.append(el('span', { class: 'lu-fonte ' + rede(r.fonte), text: r.fonte })); td.dataset.csv = r.fonte;
  }]);
  $('.c-th-loja', card).hidden = !multi;
  const tb = tabela($('#tb-cheg', card), { chave: 'chave_lead', sort: 'primeira_msg', busca: $('.q-cheg', card), texto: (r) => [r.nome, r.vendedor, r.loja, r.etapa, r.fonte].join(' '), cols });
  const tbLojas = multi ? tabela($('#tb-cheg-lojas', card), {
    chave: 'loja_id', sort: 'leads',
    cols: [['txt name', (td, r) => { td.textContent = r.loja; }],
      [null, (td, r) => { td.textContent = fmt.int(r.leads); }],
      [null, (td, r) => { td.textContent = r.leads ? fmt.pct((100 * r.respondidos) / r.leads) : '—'; }],
      [null, (td, r) => { td.textContent = r.respondidos ? fmt.pct((100 * r.dentro_sla) / r.respondidos) : '—'; }]],
  }) : null;
  boxLojas.hidden = !multi;

  const validar = () => {
    if (!datas.de || !datas.ate) return 'Escolha as duas datas.';
    if (datas.de > datas.ate) return 'A data inicial é depois da final.';
    if ((Date.parse(datas.ate) - Date.parse(datas.de)) / 864e5 > 366) return 'Escolha no máximo 1 ano.';
    if (st.modo === 'corrido') {
      if (datas.de === datas.ate && st.de && st.ate && st.de >= st.ate) return 'No mesmo dia, o horário final precisa ser depois do inicial.';
      return null;
    }
    if (st.modo !== 'entre' && !st.de) return 'Escolha o horário.';
    return null;
  };
  const marcarAtalho = () => {
    $$('.lu-cheg-atalhos button', card).forEach((b) => {
      const r = b.dataset.p === 'painel' ? [filtros.inicio, filtros.fim] : intervalo(b.dataset.p);
      b.classList.toggle('on', !!r && r[0] === datas.de && r[1] === datas.ate);
    });
  };
  const texto = () => {
    const { modo, de, ate } = st;
    if (modo === 'corrido') return 'de ' + fmt.dmy(datas.de) + ' às ' + (hm(de) || '0h') + ' até ' + fmt.dmy(datas.ate) + ' às ' + (ate ? hm(ate) : '24h') + NOME_DIAS[st.dias];
    const b = modo === 'depois' ? 'depois das ' + hm(de) : modo === 'antes' ? 'antes das ' + hm(de)
      : modo === 'em' ? 'entre ' + hm(de.slice(0, 2) + ':00') + ' e ' + Number(de.slice(0, 2)) + 'h59'
      : !de && !ate ? 'em qualquer horário' : 'das ' + (hm(de) || '0h') + ' às ' + (ate ? hm(ate) : '24h');
    return b + NOME_DIAS[st.dias];
  };
  const textoFontes = () => (st.fontes.length ? ', vindos de ' + st.fontes.map(nomeFonte).join(' ou ') : '');
  const naFaixaHora = (h) => !!dados && Number(dados.por_hora?.[h]?.na_faixa) > 0;
  const put = (cls, v) => { const n = $('.' + cls, card); n.classList.remove('sk'); n.textContent = v; };
  const salvar = () => { try { localStorage.setItem('lu-chegada2', JSON.stringify(st)); } catch { /* sem storage */ } };
  // Fontes: caixinhas montadas com a lista que o banco devolve (contada antes do filtro de fonte)
  const dd = $('.lu-fontes-dd', card), listaF = $('.c-fontes', card);
  const resumoFontes = () => {
    const n = st.fontes.length;
    $('.c-fontes-txt', card).textContent = !n ? 'Todas as fontes' : n === 1 ? nomeFonte(st.fontes[0]) : n + ' fontes';
    dd.classList.toggle('on', n > 0);
  };
  const montarFontes = () => {
    const lista = [...(dados?.fontes || [])];
    st.fontes.forEach((f) => { if (!lista.some((x) => x.fonte === f)) lista.push({ fonte: f, leads: 0 }); });
    listaF.replaceChildren();
    if (!lista.length) { listaF.append(el('p', { class: 'vazio', text: 'Nenhuma fonte no período.' })); return; }
    lista.forEach(({ fonte, leads }) => {
      const cb = el('input', { type: 'checkbox', value: fonte }); cb.checked = st.fontes.includes(fonte);
      const lb = el('label', { class: 'op' });
      lb.append(cb, el('span', { class: 'lu-fonte ' + rede(fonte) + (fonte ? '' : ' sem'), text: nomeFonte(fonte) }), el('small', { text: fmt.int(leads) }));
      listaF.append(lb);
    });
  };
  const mudouFontes = (fontes) => {
    st = { ...st, fontes }; salvar(); resumoFontes();
    $$('input', listaF).forEach((c) => { c.checked = fontes.includes(c.value); });
    clearTimeout(timer); timer = setTimeout(carregar, 450);
  };
  listaF.addEventListener('change', () => mudouFontes($$('input:checked', listaF).map((c) => c.value)));
  $('.act-fontes-todas', card).addEventListener('click', () => mudouFontes($$('input', listaF).map((c) => c.value)));
  $('.act-fontes-limpar', card).addEventListener('click', () => mudouFontes([]));
  document.addEventListener('click', (e) => { if (dd.open && !dd.contains(e.target)) dd.open = false; });
  dd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { dd.open = false; $('summary', dd).focus(); } });
  const sincronizar = () => {
    sModo.value = st.modo; iDe.value = st.de; iAte.value = st.ate; sDias.value = st.dias;
    const faixa = st.modo === 'entre' || st.modo === 'corrido';
    $('.c-ate-box', card).hidden = !faixa;
    $('.c-dica', card).hidden = !faixa;
    $('.c-de-rot', card).textContent = st.modo === 'corrido' ? 'Começa às' : st.modo === 'entre' ? 'De' : 'Horário';
    $('.c-ate-rot', card).textContent = st.modo === 'corrido' ? 'Termina às' : 'Até';
    $('.c-dica', card).textContent = st.modo === 'corrido'
      ? 'Período corrido: começa na data inicial nesse horário e vai até a data final no horário de término (ex.: ontem 18h até hoje 10h).'
      : 'Deixe em branco para pegar desde 0h ou até a meia-noite.';
    resumoFontes();
  };

  const desenhar = () => {
    $('.slot-cheg-desc', card).textContent = (st.modo === 'corrido' ? '' : 'De ' + fmt.dmy(datas.de) + ' a ' + fmt.dmy(datas.ate) + ': ') + (st.modo === 'corrido' ? 'Leads' : 'leads') + ' que chegaram ' + texto() + textoFontes() + '. Pelo horário da 1ª mensagem do cliente (horário de Brasília).';
    if (!dados) return;
    montarFontes();
    const r = dados.resumo || {}, n = Number(r.leads) || 0, tot = Number(dados.total) || 0;
    put('c-leads', fmt.int(n));
    $('.c-leads-sub', card).textContent = 'leads na faixa' + (tot ? ' · ' + fmt.pct((100 * n) / tot) + ' do total' : '');
    put('c-resp', n ? fmt.pct((100 * r.respondidos) / n) : '—');
    put('c-sla', Number(r.respondidos) ? fmt.pct((100 * r.dentro_sla) / r.respondidos) : '—');
    put('c-sem', fmt.int(r.sem_resposta));
    box.classList.remove('sk');
    grafico(box, dados.por_hora || [], naFaixaHora);
    const ls = (dados.leads || []).map((l, i) => ({ ...l, chave_lead: String(i) }));
    $('.slot-cheg-nota', card).textContent = fmt.int(n) + (n === 1 ? ' lead chegou ' : ' leads chegaram ') + texto() + textoFontes()
      + (n > ls.length ? '. Mostrando os ' + fmt.int(ls.length) + ' mais recentes.' : '.');
    tb.dados(ls);
    if (tbLojas) tbLojas.dados(dados.por_loja || []);
  };
  const carregar = async () => {
    const msg = validar(); erro.hidden = !msg; erro.textContent = msg || '';
    if (msg) return;
    const meu = ++pedido;
    box.classList.add('sk'); tb.carregando(); tbLojas?.carregando();
    try {
      const d = await rpc('atend_chegada', {
        p_inicio: datas.de, p_fim: datas.ate, p_conta: filtros.conta || null, p_modo: st.modo,
        p_de: st.de || '00:00', p_ate: (st.modo === 'entre' || st.modo === 'corrido') ? (st.ate || '24:00') : '24:00', p_dias: st.dias,
        p_fontes: st.fontes.length ? st.fontes : null,
      });
      if (meu !== pedido) return;
      dados = d; desenhar();
    } catch (e) {
      if (meu !== pedido) return;
      falha(box, e.message); box.classList.remove('sk'); tb.falha(e.message); tbLojas?.falha(e.message);
      ['c-leads', 'c-resp', 'c-sla', 'c-sem'].forEach((c) => put(c, '—'));
    }
  };
  const mudou = () => {
    st = { ...st, modo: sModo.value, de: iDe.value, ate: iAte.value, dias: sDias.value };
    sincronizar(); salvar();
    clearTimeout(timer); timer = setTimeout(carregar, 350);
  };
  [sModo, sDias].forEach((s) => s.addEventListener('change', mudou));
  [iDe, iAte].forEach((i) => i.addEventListener('change', mudou));
  const mudouDatas = () => { datas = { de: iD1.value, ate: iD2.value }; marcarAtalho(); if (dados) desenhar(); clearTimeout(timer); timer = setTimeout(carregar, 350); };
  [iD1, iD2].forEach((i) => i.addEventListener('change', mudouDatas));
  $('.lu-cheg-atalhos', card).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    const r = b.dataset.p === 'painel' ? [filtros.inicio, filtros.fim] : intervalo(b.dataset.p);
    if (!r) return;
    iD1.value = r[0]; iD2.value = r[1]; mudouDatas();
  });
  $('.act-cheg-limpar', card).addEventListener('click', () => {
    st = { ...PADRAO }; datas = { de: filtros.inicio, ate: filtros.fim }; iD1.value = datas.de; iD2.value = datas.ate;
    sincronizar(); salvar(); marcarAtalho(); carregar();
  });
  iD1.value = datas.de; iD2.value = datas.ate; marcarAtalho();
  sincronizar();

  return { carregar, redesenhar() { if (dados) grafico(box, dados.por_hora || [], naFaixaHora); } };
};
