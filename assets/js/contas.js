/* Central LevelUp › Contas (só Dev): nome/SLA/ativa das subcontas, ligação dos grupos de CRM e registro de ações. */
import { $, el, clone, rpc, fmt, toast } from './core.js?v=202611161831';

const ACOES = {
  conta_salvar: 'Alterou conta', grupo_ligar: 'Ligou grupo', criar_membro: 'Criou acesso', salvar_membro: 'Editou acesso', remover_membro: 'Removeu acesso',
  redefinir_senha: 'Redefiniu senha', somar_lojas: 'Deu loja a cliente', enviar_whatsapp: 'Enviou relatório', disparo_criar: 'Criou disparo',
  disparo_pausar: 'Pausou disparo', disparo_retomar: 'Retomou disparo', disparo_cancelar: 'Cancelou disparo', disparo_reenviar: 'Reenviou mensagem',
  grupo_pausar: 'Pausou grupo', grupo_retomar: 'Liberou grupo', automacao_ligar: 'Pediu para ligar automação', automacao_desligar: 'Pediu para desligar automação',
  automacao_conta: 'Mudou automação por conta', bom_dia_salvar: 'Salvou o Bom dia', relatorio_agenda: 'Mudou relatório automático',
};
const resumo = (d) => {
  if (!d || typeof d !== 'object') return '';
  if (d.depois) return Object.entries(d.depois).filter(([k, v]) => String(d.antes?.[k]) !== String(v)).map(([k, v]) => k + ': ' + (d.antes?.[k] ?? '—') + ' → ' + v).join(' · ');
  return Object.entries(d).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => k + ': ' + v).join(' · ').slice(0, 160);
};

export const renderContas = async (main) => {
  main.replaceChildren(clone('tpl-contas'));
  const q = $('.q-contas', main);
  let dados = { contas: [], clientes: [], grupos: [], eventos: [] };

  const linhaConta = (c) => {
    const nome = el('input', { class: 'ct-nome', value: c.nome, 'aria-label': 'Nome da conta' });
    const sla = el('input', { type: 'number', class: 'ct-sla', min: 1, max: 240, value: c.sla_min ?? 10, 'aria-label': 'SLA em minutos' });
    const sw = el('input', { type: 'checkbox', class: 'lu-switch', role: 'switch', 'aria-label': 'Conta ativa' }); sw.checked = !!c.ativo;
    const btn = el('button', { type: 'button', class: 'lu-ghost sm', hidden: true, text: 'Salvar' });
    const tr = el('tr', { class: c.ativo ? '' : 'off' },
      el('td', { class: 'txt' }, nome, el('small', { class: 'muted ct-id', text: '#' + c.id })),
      el('td', { class: 'txt hide-sm muted', text: c.cliente || '—' }), el('td', {}, sla), el('td', {}, sw),
      el('td', { class: 'txt hide-sm' }, el('span', { class: c.status_carga === 'success' ? 'muted' : 'lu-ctl-erro-txt', title: c.erro_carga || '', text: c.ultima_carga ? fmt.dt(c.ultima_carga) + (c.status_carga !== 'success' ? ' · ' + (c.status_carga || 'erro') : '') : '—' })),
      el('td', {}, btn));
    tr.addEventListener('input', () => { btn.hidden = false; });
    tr.addEventListener('change', () => { btn.hidden = false; });
    btn.addEventListener('click', async () => {
      if (c.ativo && !sw.checked && !confirm('Desativar "' + c.nome + '"? Ela some do painel, dos relatórios e para de ser carregada.')) return;
      btn.disabled = true;
      try { await rpc('atend_dev_conta_salvar', { p_id: c.id, p_nome: nome.value, p_ativo: sw.checked, p_sla_min: Number(sla.value) }); toast('Conta salva.'); await carregar(); }
      catch (e) { toast(e.message, true); btn.disabled = false; }
    });
    return tr;
  };
  const linhaGrupo = (g) => {
    const selC = el('select', { class: 'gr-cli', 'aria-label': 'Cliente do grupo' }, el('option', { value: '', text: '— sem cliente —' }), ...dados.clientes.map((c) => el('option', { value: c.id, text: c.nome })));
    selC.value = g.cliente_id ?? '';
    const selL = el('select', { class: 'gr-loja', 'aria-label': 'Loja do grupo' });
    const lojasDe = () => {
      const cid = Number(selC.value);
      selL.replaceChildren(el('option', { value: '', text: cid ? 'Todas as lojas do cliente' : '—' }), ...dados.contas.filter((c) => c.ativo && Number(c.cliente_id) === cid).map((c) => el('option', { value: c.id, text: c.nome })));
    };
    lojasDe(); selL.value = g.loja_id ?? '';
    const btn = el('button', { type: 'button', class: 'lu-ghost sm', hidden: true, text: 'Salvar' });
    selC.addEventListener('change', () => { lojasDe(); btn.hidden = false; });
    selL.addEventListener('change', () => { btn.hidden = false; });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await rpc('atend_dev_grupo_ligar', { p_jid: g.jid, p_cliente: selC.value ? Number(selC.value) : null, p_loja: selL.value ? Number(selL.value) : null }); toast('Grupo ligado.'); await carregar(); }
      catch (e) { toast(e.message, true); btn.disabled = false; }
    });
    return el('tr', {}, el('td', { class: 'txt name' }, g.nome, g.cliente_id ? null : el('span', { class: 'lu-badge warn ct-badge', text: 'sem cliente' }), g.manual ? el('small', { class: 'muted ct-id', text: 'ligado à mão' }) : null),
      el('td', {}, selC), el('td', {}, selL), el('td', {}, btn));
  };
  const desenhar = () => {
    const t = q.value.trim().toLowerCase();
    const cs = dados.contas.filter((c) => !t || [c.nome, c.cliente].join(' ').toLowerCase().includes(t));
    $('#tb-contas tbody', main).replaceChildren(...cs.map(linhaConta));
    const at = dados.contas.filter((c) => c.ativo).length;
    $('.slot-ct-total', main).textContent = at + ' ativas de ' + dados.contas.length;
    $('#tb-grupos tbody', main).replaceChildren(...dados.grupos.map(linhaGrupo));
    $('#tb-eventos tbody', main).replaceChildren(...(dados.eventos.length ? dados.eventos.map((e) => el('tr', {},
      el('td', { class: 'txt mono', text: fmt.dt(e.em) }), el('td', { class: 'txt', text: e.por || 'sistema' }),
      el('td', { class: 'txt', text: ACOES[e.acao] || e.acao }), el('td', { class: 'txt hide-sm muted wrap', text: resumo(e.detalhe) })))
      : [el('tr', {}, el('td', { class: 'txt muted', colspan: 4, text: 'Nada registrado ainda.' }))]));
  };
  const carregar = async () => { dados = await rpc('atend_dev_contas'); desenhar(); };
  q.addEventListener('input', () => { $('#tb-contas tbody', main).replaceChildren(...dados.contas.filter((c) => !q.value.trim() || [c.nome, c.cliente].join(' ').toLowerCase().includes(q.value.trim().toLowerCase())).map(linhaConta)); });
  try { await carregar(); } catch (e) { $('#tb-contas tbody', main).replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 6 }, el('div', { class: 'lu-fail', text: e.message })))); }
};
