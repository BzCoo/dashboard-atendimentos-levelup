/* Central LevelUp › Tráfego › Saldos (Dev e Gestor): saldo de cada conta de anúncio, quanto ainda dura,
   limite de aviso por conta e histórico dos avisos de saldo baixo. Clientes não veem esta página. */
import { $, $$, el, clone, rpc, fmt, toast } from './core.js?v=202611231234';

const CRIT = 2, ATENC = 5;   // dias de saldo: vermelho abaixo de 2, amarelo abaixo de 5

// Situação de uma conta: 'bad' | 'warn' | 'ok' | 'off'
const situacao = (c) => {
  if (!c.ativa) return 'off';
  const abaixo = c.limite !== null && c.saldo !== null && Number(c.saldo) < Number(c.limite);
  const d = c.dias_restantes === null ? null : Number(c.dias_restantes);
  if ((d !== null && d < CRIT) || (abaixo && d === null)) return 'bad';
  if (abaixo || (d !== null && d < ATENC)) return 'warn';
  return 'ok';
};
const textoDias = (c) => {
  if (!c.prepaga) return 'Pós-paga';
  if (c.dias_restantes === null) return Number(c.media_dia) > 0 ? '—' : 'Sem gasto';
  const d = Number(c.dias_restantes);
  return d < 1 ? 'Menos de 1 dia' : d >= 60 ? '60+ dias' : fmt.num1(d).replace(',0', '') + ' dias';
};
const ontem = () => { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

export const renderTrafego = async (main) => {
  main.replaceChildren(clone('tpl-trafego'));
  const q = $('.q-trf', main);
  let dados = { contas: [], alertas: [] };
  let filtro = 'atencao';

  const celLimite = (c) => {
    const inp = el('input', { type: 'number', min: 0, step: 50, class: 'trf-lim', 'aria-label': 'Avisar abaixo de (R$) — ' + c.nome, value: c.limite ?? '', placeholder: 'sem aviso' });
    const salvar = el('button', { type: 'button', class: 'lu-ghost sm', hidden: true, text: 'Salvar' });
    const padrao = c.limite_proprio ? el('button', { type: 'button', class: 'lu-link sm', title: 'Voltar ao padrão: pré-paga avisa abaixo de R$ 200; pós-paga não avisa', text: 'padrão' }) : null;
    inp.addEventListener('input', () => { salvar.hidden = false; });
    const enviar = async (args, ok) => {
      salvar.disabled = true;
      try { await rpc('atend_trafego_limite_salvar', args); toast(ok); await carregar(); }
      catch (e) { toast(e.message, true); salvar.disabled = false; }
    };
    salvar.addEventListener('click', () => {
      const v = inp.value.trim();
      enviar({ p_conta: c.id, p_limite: v === '' ? null : Number(v), p_padrao: false }, v === '' ? 'Aviso desligado para ' + c.nome + '.' : 'Aviso de ' + c.nome + ' abaixo de ' + fmt.brl0(v) + '.');
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvar.click(); } });
    padrao?.addEventListener('click', () => enviar({ p_conta: c.id, p_limite: null, p_padrao: true }, 'Limite de ' + c.nome + ' voltou ao padrão.'));
    return el('div', { class: 'trf-lim-cel' }, el('span', { class: 'trf-rs', 'aria-hidden': 'true', text: 'R$' }), inp, salvar, padrao);
  };

  const linha = (c) => {
    const s = situacao(c);
    const semDados = c.sync_status && c.sync_status !== 'success';
    return el('tr', { class: s === 'off' ? 'off' : '' },
      el('td', { class: 'txt name' }, el('i', { class: 'trf-pt ' + s, 'aria-hidden': 'true' }), el('b', { class: 'trf-nome', text: c.nome }),
        el('small', { class: 'muted trf-cli', text: (c.cliente || '—') + (c.ativa ? '' : ' · inativa') })),
      el('td', { class: 'num', 'data-label': 'Saldo' }, el('b', { class: 'trf-saldo', text: c.saldo === null ? '—' : fmt.brl(c.saldo) }),
        el('small', { class: 'muted', text: c.prepaga ? 'pré-paga' : 'pós-paga · a faturar' })),
      el('td', { 'data-label': 'Dura' }, el('span', { class: 'lu-badge trf-dias ' + (s === 'bad' ? 'off' : s === 'warn' ? 'warn' : s === 'ok' && c.prepaga ? 'ok' : ''), text: textoDias(c) })),
      el('td', { class: 'num hide-sm', 'data-label': 'Média/dia', text: Number(c.media_dia) > 0 ? fmt.brl(c.media_dia) : '—' }),
      el('td', { class: 'num hide-sm', 'data-label': 'Ontem', text: Number(c.gasto_ontem) > 0 ? fmt.brl(c.gasto_ontem) : '—' }),
      el('td', { 'data-label': 'Avisar abaixo de' }, celLimite(c)),
      el('td', { class: 'txt hide-sm', 'data-label': 'Dados de gasto' }, el('span', { class: semDados ? 'lu-ctl-erro-txt' : 'muted', title: c.sync_erro || '',
        text: c.ult_dia_dados ? 'até ' + fmt.dm(c.ult_dia_dados) + (semDados ? ' · erro' : '') : semDados ? 'erro na coleta' : 'sem gasto' })));
  };

  const desenhar = () => {
    const t = q.value.trim().toLowerCase();
    const base = dados.contas.filter((c) => !t || [c.nome, c.cliente, c.meta_id].join(' ').toLowerCase().includes(t));
    const lista = base.filter((c) => filtro === 'todas' ? true : filtro === 'atencao' ? ['bad', 'warn'].includes(situacao(c))
      : filtro === 'pre' ? c.ativa && c.prepaga : c.ativa && !c.prepaga);
    $('#tb-trf tbody', main).replaceChildren(...(lista.length ? lista.map(linha)
      : [el('tr', {}, el('td', { class: 'txt muted', colspan: 7, text: filtro === 'atencao' && !t ? 'Nenhuma conta precisa de atenção agora. 👌' : 'Nenhuma conta encontrada.' }))]));
    const at = dados.contas.filter((c) => c.ativa);
    const n = (s) => at.filter((c) => situacao(c) === s).length;
    $$('.trf-f', main).forEach((b) => {
      const k = b.dataset.f;
      b.setAttribute('aria-pressed', String(k === filtro));
      $('em', b).textContent = k === 'todas' ? dados.contas.length : k === 'atencao' ? n('bad') + n('warn') : k === 'pre' ? at.filter((c) => c.prepaga).length : at.filter((c) => !c.prepaga).length;
    });
  };

  const resumir = () => {
    const at = dados.contas.filter((c) => c.ativa);
    const pre = at.filter((c) => c.prepaga);
    const crit = at.filter((c) => situacao(c) === 'bad').length;
    const aten = at.filter((c) => situacao(c) === 'warn').length;
    const somaSaldo = pre.reduce((s, c) => s + Number(c.saldo || 0), 0);
    const gastoOntem = at.reduce((s, c) => s + Number(c.gasto_ontem || 0), 0);
    const media = at.reduce((s, c) => s + Number(c.media_dia || 0), 0);
    const tile = (cls, valor, rotulo, sub) => el('div', { class: 'lu-ctl-sinal ' + cls }, el('b', { text: valor }), el('span', { text: rotulo }), sub ? el('small', { class: 'muted', text: sub }) : null);
    $('.slot-trf-resumo', main).replaceChildren(
      tile(crit ? 'bad' : 'ok', String(crit), 'Críticas', 'menos de ' + CRIT + ' dias ou abaixo do limite'),
      tile(aten ? 'warn' : 'ok', String(aten), 'Atenção', 'menos de ' + ATENC + ' dias de saldo'),
      tile('', fmt.brl0(somaSaldo), 'Saldo pré-pago', pre.length + ' contas pré-pagas'),
      tile('', fmt.brl0(gastoOntem), 'Gasto ontem', 'média de ' + fmt.brl0(media) + '/dia na semana'));
    // Aviso quando os dados de gasto estão atrasados
    const av = $('.slot-trf-aviso', main);
    const ult = dados.ult_dia_dados;
    if (ult && ult < ontem()) {
      av.hidden = false;
      av.textContent = 'Os dados de gasto vão só até ' + fmt.dm(ult) + '. Os dias restantes podem estar errados até a sincronização do Meta terminar (roda todo dia às 9h).';
    } else av.hidden = true;
    $('.slot-trf-quando', main).textContent = dados.saldo_em ? 'Saldo atualizado em ' + fmt.dt(dados.saldo_em) + ' · atualiza às 8h30 e 16h30' : '';
  };

  const historico = () => {
    $('#tb-trf-hist tbody', main).replaceChildren(...(dados.alertas.length ? dados.alertas.map((a) => el('tr', {},
      el('td', { class: 'txt mono', text: fmt.dt(a.em) }), el('td', { class: 'txt' }, el('b', { text: a.conta }), el('small', { class: 'muted trf-cli', text: a.cliente || '' })),
      el('td', { class: 'num', text: fmt.brl(a.saldo) }), el('td', { class: 'num hide-sm', text: fmt.brl0(a.limite) }),
      el('td', { class: 'txt hide-sm', text: a.dias === null ? '—' : fmt.num1(a.dias) + ' dias' })))
      : [el('tr', {}, el('td', { class: 'txt muted', colspan: 5, text: 'Nenhum aviso registrado ainda. Os avisos passam a aparecer aqui a partir da próxima atualização de saldo.' }))]));
  };

  const carregar = async () => {
    dados = await rpc('atend_trafego_saldos');
    resumir(); desenhar(); historico();
  };

  $$('.trf-f', main).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.f; desenhar(); }));
  q.addEventListener('input', desenhar);
  $('.act-trf-atualizar', main).addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await carregar(); } catch (er) { toast(er.message, true); }
    e.currentTarget.disabled = false;
  });
  try { await carregar(); }
  catch (e) { $('#tb-trf tbody', main).replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 7 }, el('div', { class: 'lu-fail', text: e.message })))); }
};
