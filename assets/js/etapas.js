import { $, el, clone, rpc, fmt, toast } from './core.js?v=202610281446';

export const renderEtapas = async (main, ctx) => {
  main.replaceChildren(clone('tpl-etapas'));
  const tbody = $('#tb-etapas tbody', main), selLoja = $('.f-etapa-loja', main), busca = $('.q-etapas', main), usadas = $('.f-usadas', main);
  const sync = $('.slot-sync', main), btnSync = $('.act-sync', main);
  for (const l of ctx.me.lojas) selLoja.append(el('option', { value: String(l.loja_id), text: l.loja }));
  if (ctx.filtros.conta) selLoja.value = String(ctx.filtros.conta);
  let dados = { etapas: [], ultima_sync: null };
  let timer = null;

  const mostrarSync = () => {
    const u = dados.ultima_sync;
    sync.replaceChildren();
    if (!u) { sync.textContent = 'Ainda não houve sincronização com o CRM.'; return; }
    const r = u.resultado || {};
    if (u.status === 'pendente' || u.status === 'rodando') {
      sync.append(el('b', { text: u.status === 'rodando' ? 'Sincronizando agora… ' : 'Sincronização pedida. ' }), 'A automação roda a cada minuto — esta página atualiza sozinha.');
      return;
    }
    sync.append('Última sincronização: ', el('b', { text: fmt.dt(u.concluido_em || u.pedido_em) }));
    if (u.status === 'ok') sync.append(' · ' + fmt.int(r.contas) + ' lojas, ' + fmt.int(r.etapas) + ' etapas lidas do CRM');
    else sync.append(' · ', el('b', { class: 'down', text: 'falhou' }));
    if (Array.isArray(r.falhas) && r.falhas.length) sync.append(' · ' + r.falhas.length + (r.falhas.length === 1 ? ' loja com erro' : ' lojas com erro'));
  };
  const draw = () => {
    const loja = selLoja.value, t = busca.value.trim().toLowerCase(), so = usadas.checked;
    const r = (dados.etapas || []).filter((e) => (!loja || String(e.loja_id) === loja) && (!so || Number(e.entradas_30d) > 0)
      && (!t || [e.nome, e.nome_crm, e.nome_manual, e.loja].join(' ').toLowerCase().includes(t)));
    if (!r.length) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt muted', colspan: 6, text: 'Nenhuma etapa encontrada.' }))); return; }
    tbody.replaceChildren(...r.map((e) => el('tr', { 'data-loja': String(e.loja_id), 'data-stage': e.stage_id },
      el('td', { class: 'txt muted', text: e.loja }),
      el('td', { class: 'txt name', text: e.nome || '—' }),
      el('td', { class: 'txt hide-sm muted', text: e.nome_crm || '—' }),
      el('td', { class: 'txt' }, el('div', { class: 'lu-inline' },
        el('input', { type: 'text', name: 'nome', maxlength: '80', value: e.nome_manual || '', placeholder: 'Usar nome do CRM', 'aria-label': 'Nome próprio para ' + (e.nome || 'etapa') }),
        el('button', { type: 'button', class: 'lu-ghost sm', 'data-act': 'salvar', text: 'Salvar' }))),
      el('td', { text: fmt.int(e.entradas_30d) }),
      el('td', { class: 'txt hide-sm' }, e.venda ? el('span', { class: 'lu-pill ok', text: 'venda' }) : e.avanco ? el('span', { class: 'lu-pill warn', text: 'avanço' }) : el('span', { class: 'muted', text: '—' })))));
  };
  const carregar = async (silencioso) => {
    if (!silencioso) tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt sk', colspan: 6, text: 'Carregando…' })));
    try { dados = await rpc('atend_admin_etapas') || dados; mostrarSync(); draw(); }
    catch (e) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 6 }, el('div', { class: 'lu-fail', text: e.message })))); }
    const u = dados.ultima_sync;
    clearTimeout(timer);
    if (u && (u.status === 'pendente' || u.status === 'rodando') && main.isConnected) timer = setTimeout(() => carregar(true), 15000);
  };
  for (const n of [selLoja, usadas]) n.addEventListener('change', draw);
  busca.addEventListener('input', draw);
  tbody.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act=salvar]'); if (!b) return;
    const tr = b.closest('tr'), nome = $('input', tr).value.trim();
    b.disabled = true;
    try { await rpc('atend_admin_salvar_etapa', { p_loja: Number(tr.dataset.loja), p_stage: tr.dataset.stage, p_nome: nome }); toast(nome ? 'Nome salvo.' : 'Voltou a usar o nome do CRM.'); await carregar(true); }
    catch (er) { toast(er.message, true); b.disabled = false; }
  });
  tbody.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); $('button', e.target.closest('tr')).click(); } });
  btnSync.addEventListener('click', async () => {
    btnSync.disabled = true;
    try { await rpc('atend_admin_pedir_sync'); toast('Pedido enviado. Em até 1 minuto os nomes são atualizados.'); await carregar(true); }
    catch (er) { toast(er.message, true); }
    setTimeout(() => { btnSync.disabled = false; }, 4000);
  });
  await carregar();
  return () => clearTimeout(timer);
};
