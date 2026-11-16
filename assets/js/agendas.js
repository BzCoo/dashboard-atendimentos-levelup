/* Relatórios › Envio automático por loja (equipe). A função relatorio-auto envia no horário marcado. */
import { $, el, rpc, fmt, toast } from './core.js?v=202611161827';

const DIAS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [7, 'Dom']];
const OPC = [['plano', 'Plano'], ['funil', 'Funil'], ['vend', 'Vendedores'], ['traf', 'Tráfego'], ['inv', 'Investimento']];
const PADRAO = { comp: true, funil: true, vend: true, horas: true, plano: true, traf: false, inv: false, ads: false, lojas: false };

export const montarAgendas = async (main) => {
  const tbody = $('#tb-ag tbody', main), q = $('.q-ag', main);
  let lojas = [];
  const sel = (opts, v, cls) => { const s = el('select', { class: cls }); s.append(...opts.map(([val, rot]) => el('option', { value: val, text: rot }))); s.value = String(v); return s; };

  const linha = (l) => {
    const a = l.agenda || {};
    const op = { ...PADRAO, ...(a.opcoes || {}) };
    const sw = el('input', { type: 'checkbox', class: 'lu-switch ag-ativo', role: 'switch', 'aria-label': 'Envio automático para ' + l.loja }); sw.checked = !!a.ativo;
    const dia = sel(DIAS, a.dia_semana || 5, 'ag-dia');
    const hora = el('input', { type: 'time', class: 'ag-hora', value: String(a.hora || '08:00').slice(0, 5), min: '07:00', max: '20:59' });
    const per = sel([[7, '7 dias'], [14, '14 dias'], [30, '30 dias']], a.dias_periodo || 7, 'ag-per');
    const grupos = l.grupos || [];
    const gr = grupos.length ? sel(grupos.map((g) => [g.jid, g.nome]), a.grupo_jid || grupos[0].jid, 'ag-grupo') : el('span', { class: 'muted', text: 'Sem grupo de CRM' });
    const chips = el('div', { class: 'lu-ag-chips' }, ...OPC.map(([k, rot]) => { const c = el('input', { type: 'checkbox', value: k }); c.checked = !!op[k]; return el('label', {}, c, el('span', { text: rot })); }));
    const sit = a.ultimo_status === 'erro' ? el('span', { class: 'lu-badge off', text: 'Erro', title: a.ultimo_erro || '' })
      : a.ativo ? el('span', { class: 'muted', text: 'Próximo: ' + fmt.dt(a.proximo) + (a.ultimo_envio ? ' · último ' + fmt.dt(a.ultimo_envio) : '') })
      : el('span', { class: 'muted', text: a.ultimo_envio ? 'Último ' + fmt.dt(a.ultimo_envio) : '—' });
    const btn = el('button', { type: 'button', class: 'lu-ghost sm ag-salvar', hidden: true, text: 'Salvar' });
    const tr = el('tr', { 'data-loja': l.loja_id },
      el('td', { class: 'txt name', text: l.loja }), el('td', {}, sw), el('td', { class: 'txt' }, el('div', { class: 'lu-ag-quando' }, dia, hora)),
      el('td', {}, per), el('td', { class: 'txt' }, gr), el('td', {}, chips), el('td', { class: 'txt' }, sit), el('td', {}, btn));
    tr.addEventListener('input', () => { btn.hidden = false; });
    tr.addEventListener('change', () => { btn.hidden = false; });
    btn.addEventListener('click', async () => {
      const opcoes = { ...op };
      chips.querySelectorAll('input').forEach((c) => { opcoes[c.value] = c.checked; });
      btn.disabled = true;
      try {
        const r = await rpc('atend_relatorio_agenda_salvar', { p_loja: l.loja_id, p_ativo: sw.checked, p_dia: Number(dia.value), p_hora: hora.value || '08:00',
          p_dias: Number(per.value), p_opcoes: opcoes, p_grupo: grupos.length ? gr.value : null });
        toast(sw.checked ? 'Envio automático salvo. Próximo: ' + fmt.dt(r.proximo) + '.' : 'Envio automático desligado.');
        await carregar();
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    });
    return tr;
  };
  const desenhar = () => {
    const t = q.value.trim().toLowerCase();
    const r = lojas.filter((l) => !t || String(l.loja).toLowerCase().includes(t));
    tbody.replaceChildren(...(r.length ? r.map(linha) : [el('tr', {}, el('td', { class: 'txt muted', colspan: 8, text: 'Nenhuma loja.' }))]));
    const n = lojas.filter((l) => l.agenda?.ativo).length;
    $('.slot-ag-total', main).textContent = n + (n === 1 ? ' loja com envio automático' : ' lojas com envio automático');
  };
  const carregar = async () => { lojas = await rpc('atend_relatorio_agendas') || []; desenhar(); };
  q.addEventListener('input', desenhar);
  try { await carregar(); } catch (e) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 8 }, el('div', { class: 'lu-fail', text: e.message })))); }
};
