import { $, $$, el, fmt, rpc, intervalo } from './core.js?v=202611121153';
import { chegada as grafico, falha } from './charts.js?v=202611121153';

/* Cartão "Horário de chegada dos leads": faixa de horário com minuto (entre / depois / antes / às) e dias da semana.
   Os números vêm de atend_chegada (banco), para qualquer loja ou todas. */

const NOME_DIAS = { todos: '', uteis: ', de segunda a sexta', sab: ', aos sábados', dom: ', aos domingos' };
const PADRAO = { modo: 'entre', de: '', ate: '', dias: 'todos' };
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
  let dados = null, pedido = 0, timer = null;

  // Lista: no "Todas as lojas" entra a coluna da loja
  const cols = celulasLead(true);
  if (multi) cols.splice(2, 0, ['txt muted', (td, r) => { td.textContent = r.loja || '—'; }]);
  $('.c-th-loja', card).hidden = !multi;
  const tb = tabela($('#tb-cheg', card), { chave: 'chave_lead', sort: 'primeira_msg', busca: $('.q-cheg', card), texto: (r) => [r.nome, r.vendedor, r.loja, r.etapa].join(' '), cols });
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
    const b = modo === 'depois' ? 'depois das ' + hm(de) : modo === 'antes' ? 'antes das ' + hm(de)
      : modo === 'em' ? 'entre ' + hm(de.slice(0, 2) + ':00') + ' e ' + Number(de.slice(0, 2)) + 'h59'
      : !de && !ate ? 'em qualquer horário' : 'das ' + (hm(de) || '0h') + ' às ' + (ate ? hm(ate) : '24h');
    return b + NOME_DIAS[st.dias];
  };
  const naFaixaHora = (h) => !!dados && Number(dados.por_hora?.[h]?.na_faixa) > 0;
  const put = (cls, v) => { const n = $('.' + cls, card); n.classList.remove('sk'); n.textContent = v; };
  const salvar = () => { try { localStorage.setItem('lu-chegada2', JSON.stringify(st)); } catch { /* sem storage */ } };
  const sincronizar = () => {
    sModo.value = st.modo; iDe.value = st.de; iAte.value = st.ate; sDias.value = st.dias;
    $('.c-ate-box', card).hidden = st.modo !== 'entre';
    $('.c-dica', card).hidden = st.modo !== 'entre';
    $('.c-de-rot', card).textContent = st.modo === 'entre' ? 'De' : 'Horário';
  };

  const desenhar = () => {
    $('.slot-cheg-desc', card).textContent = 'De ' + fmt.dmy(datas.de) + ' a ' + fmt.dmy(datas.ate) + ': leads que chegaram ' + texto() + '. Pelo horário da 1ª mensagem do cliente (horário de Brasília).';
    if (!dados) return;
    const r = dados.resumo || {}, n = Number(r.leads) || 0, tot = Number(dados.total) || 0;
    put('c-leads', fmt.int(n));
    $('.c-leads-sub', card).textContent = 'leads na faixa' + (tot ? ' · ' + fmt.pct((100 * n) / tot) + ' do total' : '');
    put('c-resp', n ? fmt.pct((100 * r.respondidos) / n) : '—');
    put('c-sla', Number(r.respondidos) ? fmt.pct((100 * r.dentro_sla) / r.respondidos) : '—');
    put('c-sem', fmt.int(r.sem_resposta));
    box.classList.remove('sk');
    grafico(box, dados.por_hora || [], naFaixaHora);
    const ls = (dados.leads || []).map((l, i) => ({ ...l, chave_lead: String(i) }));
    $('.slot-cheg-nota', card).textContent = fmt.int(n) + (n === 1 ? ' lead chegou ' : ' leads chegaram ') + texto()
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
        p_de: st.de || '00:00', p_ate: st.modo === 'entre' ? (st.ate || '24:00') : '24:00', p_dias: st.dias,
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
    st = { modo: sModo.value, de: iDe.value, ate: iAte.value, dias: sDias.value };
    sincronizar(); salvar();
    clearTimeout(timer); timer = setTimeout(carregar, 350);
  };
  [sModo, sDias].forEach((s) => s.addEventListener('change', mudou));
  [iDe, iAte].forEach((i) => i.addEventListener('change', mudou));
  const mudouDatas = () => { datas = { de: iD1.value, ate: iD2.value }; marcarAtalho(); clearTimeout(timer); timer = setTimeout(carregar, 350); };
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
