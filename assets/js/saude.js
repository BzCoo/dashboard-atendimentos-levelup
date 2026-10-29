import { $, el, clone, rpc, fmt, toast } from './core.js?v=202610291342';

const DIA = 24 * 3600e3;
const ACOES = {
  criar_membro: 'Criou um acesso', salvar_membro: 'Editou um acesso', remover_membro: 'Removeu um acesso', redefinir_senha: 'Redefiniu uma senha',
  enviar_whatsapp: 'Enviou mensagem no WhatsApp', vendedor_padrao: 'Definiu vendedor padrão', salvar_meta: 'Alterou meta', salvar_etapa: 'Renomeou etapa',
};
const horarioTexto = (h) => {
  if (!h || typeof h !== 'object') return 'padrão (seg–sex 9h–18h)';
  const w = h.weekdays || {}, s = h.saturday || {};
  return 'seg–sex ' + (w.start || '09:00') + '–' + (w.end || '18:00') + (s.enabled ? ' · sáb ' + (s.start || '09:00') + '–' + (s.end || '13:00') : ' · sáb não');
};

/* Página "Saúde dos dados": alertas por loja, vendedor padrão e histórico de ações */
export const renderSaude = async (main) => {
  main.replaceChildren(clone('tpl-saude'));
  const tbody = $('#tb-saude tbody', main), busca = $('.q-saude', main), soAlerta = $('.f-alertas', main);
  const tbEv = $('#tb-eventos tbody', main), buscaEv = $('.q-eventos', main);
  let dados = { lojas: [], eventos: [] }, nomesMembro = {};

  const alertas = (l) => {
    const a = [];
    if (l.status_carga && l.status_carga !== 'success') a.push('carga');
    if (!l.ultima_carga || Date.now() - Date.parse(l.ultima_carga) > 2 * DIA) a.push('carga antiga');
    if (Number(l.leads_30d) && Number(l.sem_responsavel_30d) / Number(l.leads_30d) > 0.05 && !l.vendedor_padrao) a.push('sem responsável');
    if (Number(l.etapas_sem_nome)) a.push('etapas');
    if (!l.tem_grupo_crm) a.push('grupo');
    if (!l.ultimo_gasto_meta || Date.now() - Date.parse(l.ultimo_gasto_meta + 'T12:00:00') > 3 * DIA) a.push('meta');
    return a;
  };
  const resumo = () => {
    const ls = dados.lojas, c = (fn) => ls.filter(fn).length;
    const itens = [
      ['Lojas', ls.length, ''],
      ['Com alerta', c((l) => alertas(l).length), 'warn'],
      ['Leads sem responsável (30d)', ls.reduce((s, l) => s + Number(l.sem_responsavel_30d || 0), 0), 'warn'],
      ['Sem grupo de CRM', c((l) => !l.tem_grupo_crm), 'warn'],
      ['Sem investimento do Meta recente', c((l) => alertas(l).includes('meta')), 'warn'],
    ];
    $('.slot-resumo', main).replaceChildren(...itens.map(([t, n, cls]) =>
      el('div', { class: 'lu-shell' }, el('div', { class: 'lu-core lu-saude-item ' + (n && cls ? cls : '') }, el('b', { text: fmt.int(n) }), el('span', { text: t })))));
  };
  const draw = () => {
    const t = busca.value.trim().toLowerCase();
    const ls = dados.lojas.filter((l) => (!t || (l.loja + ' ' + (l.empresa || '')).toLowerCase().includes(t)) && (!soAlerta.checked || alertas(l).length));
    if (!ls.length) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt muted', colspan: 10, text: 'Nenhuma loja.' }))); return; }
    tbody.replaceChildren(...ls.map((l) => {
      const al = alertas(l);
      const pct = Number(l.leads_30d) ? 100 * Number(l.sem_responsavel_30d) / Number(l.leads_30d) : 0;
      const sel = el('select', { class: 'lu-inline-select', 'aria-label': 'Vendedor padrão de ' + l.loja, 'data-loja': String(l.loja_id) },
        el('option', { value: '', text: '— nenhum —' }), ...(l.usuarios || []).map((u) => el('option', { value: u.id, text: u.nome })));
      sel.value = l.vendedor_padrao || '';
      const idadeMeta = l.ultimo_gasto_meta ? Math.floor((Date.now() - Date.parse(l.ultimo_gasto_meta + 'T12:00:00')) / DIA) : null;
      const cargaVelha = !l.ultima_carga || Date.now() - Date.parse(l.ultima_carga) > 2 * DIA;
      return el('tr', {},
        el('td', { class: 'txt name' }, el('div', { text: l.loja }), el('div', { class: 'muted', style: 'font-weight:400;font-size:12px', text: [l.empresa && l.empresa.toUpperCase() !== String(l.loja).toUpperCase() ? l.empresa : null, al.length ? al.length + (al.length === 1 ? ' alerta' : ' alertas') + ': ' + al.join(', ') : null].filter(Boolean).join(' · ') })),
        el('td', { class: 'txt mono ' + (cargaVelha || (l.status_carga && l.status_carga !== 'success') ? 'bad' : ''), text: fmt.dt(l.ultima_carga), title: l.erro_carga || '' }),
        el('td', { text: fmt.int(l.leads_30d) }),
        el('td', { class: pct > 5 && !l.vendedor_padrao ? 'bad' : '', text: fmt.int(l.sem_responsavel_30d) + (pct >= 1 ? ' (' + fmt.pct(pct) + ')' : '') }),
        el('td', { text: fmt.int(l.sem_resposta_30d) }),
        el('td', { class: 'txt', 'data-csv': l.vendedor_padrao_nome || '' }, sel),
        el('td', { class: Number(l.etapas_sem_nome) ? 'bad' : '', text: fmt.int(l.etapas_sem_nome) }),
        el('td', { class: 'txt' }, el('span', { class: 'lu-pill ' + (l.tem_grupo_crm ? 'ok' : 'bad'), text: l.tem_grupo_crm ? 'tem' : 'falta' })),
        el('td', { class: 'txt ' + (idadeMeta === null || idadeMeta > 3 ? 'bad' : '') , text: idadeMeta === null ? 'sem dados' : idadeMeta <= 1 ? 'em dia' : 'há ' + idadeMeta + ' dias' }),
        el('td', { class: 'txt muted hide-sm', text: horarioTexto(l.horario) + ' · SLA ' + fmt.int(l.sla_min) + ' min' }));
    }));
  };
  const drawEv = () => {
    const t = buscaEv.value.trim().toLowerCase();
    const loja = (id) => (dados.lojas.find((l) => Number(l.loja_id) === Number(id)) || {}).loja || id;
    const det = (e) => {
      const d = e.detalhe || {};
      if (e.acao === 'enviar_whatsapp') return d.grupo || (d.destino === 'levelup' ? 'Grupo interno Level Up' : d.destino || '');
      if (e.acao === 'vendedor_padrao') return loja(d.loja) + ' → ' + (d.vendedor || 'nenhum');
      if (d.membro) return nomesMembro[d.membro] || 'acesso removido';
      return Object.entries(d).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.length + ' itens' : v)).join(' · ');
    };
    const ev = dados.eventos.map((e) => ({ ...e, txt: ACOES[e.acao] || e.acao, det: det(e) }))
      .filter((e) => !t || [e.por, e.txt, e.det].join(' ').toLowerCase().includes(t));
    if (!ev.length) { tbEv.replaceChildren(el('tr', {}, el('td', { class: 'txt muted', colspan: 4, text: 'Nenhuma ação registrada.' }))); return; }
    tbEv.replaceChildren(...ev.map((e) => el('tr', {},
      el('td', { class: 'txt mono', text: fmt.dt(e.em) }), el('td', { class: 'txt name', text: e.por }),
      el('td', { class: 'txt', text: e.txt }), el('td', { class: 'txt muted wrap', text: e.det }))));
  };
  const carregar = async () => {
    tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt sk', colspan: 10, text: 'Carregando…' })));
    try {
      const [d, membros] = await Promise.all([rpc('atend_admin_saude'), rpc('atend_admin_membros').catch(() => [])]);
      dados = d || dados; nomesMembro = Object.fromEntries((membros || []).map((m) => [m.id, m.nome || m.email]));
      resumo(); draw(); drawEv();
    } catch (e) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 10 }, el('div', { class: 'lu-fail', text: e.message })))); }
  };
  busca.addEventListener('input', draw); soAlerta.addEventListener('change', draw); buscaEv.addEventListener('input', drawEv);
  tbody.addEventListener('change', async (e) => {
    const s = e.target.closest('select[data-loja]'); if (!s) return;
    s.disabled = true;
    try {
      const r = await rpc('atend_admin_salvar_vendedor_padrao', { p_loja: Number(s.dataset.loja), p_ghl_user_id: s.value || null });
      toast(r?.vendedor ? 'Vendedor padrão: ' + r.vendedor + '. Vale para os próximos leads sem responsável.' : 'Vendedor padrão removido.');
      await carregar();
    } catch (er) { toast(er.message, true); s.disabled = false; }
  });
  await carregar();
};
