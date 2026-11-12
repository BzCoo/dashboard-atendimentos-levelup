import { $, el, fmt } from './core.js?v=202611121114';
import { chegada as grafico, falha } from './charts.js?v=202611121114';

/* Cartão "Horário de chegada dos leads": filtra por faixa de hora (entre / depois / antes / às) e dias da semana.
   Usa as contagens por dia×hora de atend_horarios e, numa loja só, a lista de atend_leads (horário exato). */

const DIAS = { todos: [1, 2, 3, 4, 5, 6, 7], uteis: [1, 2, 3, 4, 5], sab: [6], dom: [7] };
const NOME_DIAS = { todos: '', uteis: ', de segunda a sexta', sab: ', aos sábados', dom: ', aos domingos' };
const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
const horaLocal = (iso) => {
  const p = partes.formatToParts(new Date(iso));
  return { h: Number(p.find((x) => x.type === 'hour')?.value) % 24, d: WD[p.find((x) => x.type === 'weekday')?.value] };
};
const PADRAO = { modo: 'entre', h1: 0, h2: 24, dias: 'todos' };

export const montarChegada = (main, { tabela, celulasLead }) => {
  const card = $('.lu-cheg', main);
  if (!card) return { horarios() {}, leads() {}, falhou() {}, redesenhar() {} };
  const sModo = $('.c-modo', card), sH1 = $('.c-h1', card), sH2 = $('.c-h2', card), sDias = $('.c-dias', card);
  const box = $('#ch-chegada', card), lista = $('.lu-cheg-lista', card);
  sH1.replaceChildren(...Array.from({ length: 24 }, (_, h) => el('option', { value: h, text: h + 'h' })));
  sH2.replaceChildren(...Array.from({ length: 24 }, (_, i) => el('option', { value: i + 1, text: i + 1 === 24 ? '24h (meia-noite)' : i + 1 + 'h' })));

  let st = { ...PADRAO };
  try { st = { ...PADRAO, ...JSON.parse(localStorage.getItem('lu-chegada') || '{}') }; } catch { /* sem storage */ }
  let rows = null, leads = null, totalLeads = 0;
  const tb = tabela($('#tb-cheg', card), { chave: 'chave_lead', sort: 'primeira_msg', texto: (r) => r.nome, cols: celulasLead(true) });

  const naFaixa = (h) => {
    const { modo, h1, h2 } = st;
    if (modo === 'depois') return h >= h1;
    if (modo === 'antes') return h < h1;
    if (modo === 'em') return h === h1;
    if (h1 === h2 % 24 && h2 !== 24) return true;
    return h1 < h2 ? h >= h1 && h < h2 : h >= h1 || h < h2; // faixa que passa da meia-noite (ex.: 22h às 6h)
  };
  const texto = () => {
    const { modo, h1, h2 } = st;
    const base = modo === 'depois' ? 'depois das ' + h1 + 'h' : modo === 'antes' ? 'antes das ' + h1 + 'h'
      : modo === 'em' ? 'entre ' + h1 + 'h e ' + h1 + 'h59' : h1 === 0 && h2 === 24 ? 'em qualquer horário' : 'das ' + h1 + 'h às ' + (h2 === 24 ? '24h' : h2 + 'h');
    return base + NOME_DIAS[st.dias];
  };
  const salvar = () => { try { localStorage.setItem('lu-chegada', JSON.stringify(st)); } catch { /* sem storage */ } };
  const sincronizar = () => {
    sModo.value = st.modo; sH1.value = String(st.h1); sH2.value = String(st.h2); sDias.value = st.dias;
    $('.c-h2-box', card).hidden = st.modo !== 'entre';
    $('.c-h1-rot', card).textContent = st.modo === 'entre' ? 'De' : 'Hora';
  };
  const put = (cls, v) => { const n = $('.' + cls, card); n.classList.remove('sk'); n.textContent = v; };

  const desenhar = () => {
    $('.slot-cheg-desc', card).textContent = 'Leads que chegaram ' + texto() + '. Pelo horário da 1ª mensagem do cliente (horário de Brasília).';
    if (rows) {
      const dias = new Set(DIAS[st.dias]);
      const horas = Array.from({ length: 24 }, (_, h) => ({ h, atendimentos: 0, respondidos: 0, dentro_sla: 0 }));
      for (const r of rows) {
        if (!dias.has(Number(r.dia_semana))) continue;
        const x = horas[Number(r.hora)]; if (!x) continue;
        x.atendimentos += Number(r.atendimentos) || 0; x.respondidos += Number(r.respondidos) || 0; x.dentro_sla += Number(r.dentro_sla) || 0;
      }
      const tot = horas.reduce((s, x) => s + x.atendimentos, 0);
      const fx = horas.filter((x) => naFaixa(x.h));
      const n = fx.reduce((s, x) => s + x.atendimentos, 0), resp = fx.reduce((s, x) => s + x.respondidos, 0), sla = fx.reduce((s, x) => s + x.dentro_sla, 0);
      const pico = fx.reduce((m, x) => (x.atendimentos > (m?.atendimentos || 0) ? x : m), null);
      put('c-leads', fmt.int(n));
      $('.c-leads-sub', card).textContent = 'leads na faixa' + (tot ? ' · ' + fmt.pct((100 * n) / tot) + ' do total' : '');
      put('c-resp', n ? fmt.pct((100 * resp) / n) : '—');
      put('c-sla', resp ? fmt.pct((100 * sla) / resp) : '—');
      put('c-pico', pico ? pico.h + 'h' : '—');
      $('.c-pico-sub', card).textContent = pico ? 'hora com mais leads na faixa (' + fmt.int(pico.atendimentos) + ')' : 'hora com mais leads na faixa';
      box.classList.remove('sk');
      grafico(box, horas, naFaixa);
    }
    if (leads) {
      const dias = new Set(DIAS[st.dias]);
      const sel = leads.filter((l) => { if (!l.primeira_msg) return false; const { h, d } = horaLocal(l.primeira_msg); return dias.has(d) && naFaixa(h); });
      lista.hidden = false;
      const parcial = totalLeads > leads.length;
      $('.slot-cheg-nota', card).textContent = fmt.int(sel.length) + (sel.length === 1 ? ' lead chegou ' : ' leads chegaram ') + texto()
        + (parcial ? ' (entre os ' + fmt.int(leads.length) + ' mais recentes do período).' : '.');
      tb.dados(sel);
    }
  };
  const mudou = () => {
    st = { modo: sModo.value, h1: Number(sH1.value), h2: Number(sH2.value), dias: sDias.value };
    sincronizar(); salvar(); desenhar();
  };
  [sModo, sH1, sH2, sDias].forEach((s) => s.addEventListener('change', mudou));
  $('.act-cheg-limpar', card).addEventListener('click', () => { st = { ...PADRAO }; sincronizar(); salvar(); desenhar(); });
  sincronizar();
  tb.carregando();

  return {
    horarios(r) { rows = Array.isArray(r) ? r : []; desenhar(); },
    leads(ls, total) { leads = ls; totalLeads = Number(total) || ls.length; desenhar(); },
    falhou(msg) { falha(box, msg); box.classList.remove('sk'); ['c-leads', 'c-resp', 'c-sla', 'c-pico'].forEach((c) => put(c, '—')); },
    redesenhar() { if (rows) desenhar(); },
  };
};
