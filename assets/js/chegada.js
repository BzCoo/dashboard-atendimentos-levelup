import { $, el, fmt, rpc } from './core.js?v=202611121148';
import { chegada as grafico, falha } from './charts.js?v=202611121148';

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

  const faixaValida = () => (st.modo === 'entre' ? true : !!st.de);
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
    $('.c-de-rot', card).textContent = st.modo === 'entre' ? 'De' : 'Horário';
  };

  const desenhar = () => {
    $('.slot-cheg-desc', card).textContent = 'Leads que chegaram ' + texto() + '. Pelo horário da 1ª mensagem do cliente (horário de Brasília).';
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
    if (!faixaValida()) { $('.slot-cheg-desc', card).textContent = 'Escolha o horário.'; return; }
    const meu = ++pedido;
    box.classList.add('sk'); tb.carregando(); tbLojas?.carregando();
    try {
      const d = await rpc('atend_chegada', {
        p_inicio: filtros.inicio, p_fim: filtros.fim, p_conta: filtros.conta || null, p_modo: st.modo,
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
  $('.act-cheg-limpar', card).addEventListener('click', () => { st = { ...PADRAO }; sincronizar(); salvar(); carregar(); });
  sincronizar();

  return { carregar, redesenhar() { if (dados) grafico(box, dados.por_hora || [], naFaixaHora); } };
};
