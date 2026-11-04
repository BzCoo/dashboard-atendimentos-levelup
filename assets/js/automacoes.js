import { $, $$, el, clone, rpc, fmt, toast, copiar } from './core.js?v=202611041557';

/* Aba "Automações" (só admins): pede ao n8n, acompanha com barra de progresso e mostra o relatório por conta */

const PADRAO_SEG = { recarregar: 150, pipeline: 300, aguardando: 90, etapas: 5, anuncio_origem: 60, relatorio_ia: 90 };
const SITU = {
  pendente: ['warn', 'na fila'], executando: ['warn', 'rodando'], concluido: ['ok', 'concluída'], falhou: ['bad', 'falhou'], cancelado: ['', 'cancelada'],
  ok: ['ok', 'ok'], ignorado: ['', 'pulada'],
};
const pill = (s) => { const [c, t] = SITU[s] || ['', s || '—']; return el('span', { class: 'lu-pill ' + c, text: t }); };
const iso = (d) => d.toISOString().slice(0, 10);
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const somaDias = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dur = (seg) => {
  if (!Number.isFinite(seg) || seg < 0) return '—';
  seg = Math.round(seg);
  if (seg < 60) return seg + ' s';
  const m = Math.floor(seg / 60), s = seg % 60;
  if (m < 60) return m + ' min' + (s && m < 10 ? ' ' + s + ' s' : '');
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
};
const segEntre = (a, b) => (a ? ((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000 : NaN);
const ehFim = (s) => ['concluido', 'falhou', 'cancelado'].includes(s);
const itemFeito = (s) => ['ok', 'falhou', 'ignorado', 'cancelado'].includes(s);

/* Campos do formulário por tipo (o banco valida os limites de novo) */
const CAMPOS = {
  periodo: (c) => [
    el('label', { class: 'lu-field' }, 'Início', el('input', { type: 'date', name: 'inicio', value: somaDias(hojeSP(), -7), max: hojeSP(), required: true })),
    el('label', { class: 'lu-field' }, 'Fim', el('input', { type: 'date', name: 'fim', value: hojeSP(), max: hojeSP(), required: true }),
      el('small', { class: 'lu-help', text: 'Até ' + (c.max_dias || 90) + ' dias.' })),
  ],
  semana: () => {
    // última semana completa (segunda a domingo)
    const h = new Date(hojeSP() + 'T12:00:00Z'), dow = (h.getUTCDay() + 6) % 7;
    const seg = somaDias(hojeSP(), -dow - 7);
    const fim = el('small', { class: 'lu-help' });
    const inp = el('input', { type: 'date', name: 'inicio', value: seg, max: somaDias(hojeSP(), -7), required: true });
    const at = () => { fim.textContent = inp.value ? '7 dias: até ' + fmt.dmy(somaDias(inp.value, 6)) + '.' : ''; };
    inp.addEventListener('input', at); at();
    return [el('label', { class: 'lu-field' }, 'Início da semana', inp, fim)];
  },
  janela_dias: () => [el('label', { class: 'lu-field' }, 'Conversas dos últimos',
    el('select', { name: 'janela_dias' }, ...[[1, '1 dia'], [3, '3 dias'], [7, '7 dias'], [15, '15 dias'], [30, '30 dias']].map(([v, t]) => el('option', { value: v, text: t, selected: v === 7 }))),
    el('small', { class: 'lu-help', text: 'Só leads com mensagem nessa janela.' }))],
  janela_horas: () => [el('label', { class: 'lu-field' }, 'Conversas das últimas',
    el('select', { name: 'janela_horas' }, ...[[6, '6 horas'], [24, '24 horas'], [48, '2 dias'], [72, '3 dias'], [168, '7 dias']].map(([v, t]) => el('option', { value: v, text: t, selected: v === 24 }))))],
  max_leads: () => [el('label', { class: 'lu-field' }, 'Máximo de leads por conta',
    el('input', { type: 'number', name: 'max_leads', min: 1, max: 300, value: 100, inputmode: 'numeric' }))],
  reanalisar: () => [el('label', { class: 'lu-toggle', style: 'align-self:end' }, el('input', { class: 'lu-check', type: 'checkbox', name: 'reanalisar' }),
    ' Reanalisar leads já analisados (sem mensagem nova)')],
  enviar: () => [el('label', { class: 'lu-toggle', style: 'align-self:end' }, el('input', { class: 'lu-check', type: 'checkbox', name: 'enviar' }),
    ' Também enviar no WhatsApp de sempre')],
};

/* Resumo de uma conta, em texto, conforme a automação */
const resumoItem = (tipo, it) => {
  const r = it.resultado || {};
  if (it.status === 'ignorado' || it.status === 'falhou') return it.erro || '';
  if (it.status === 'cancelado') return 'Cancelada antes de começar';
  if (it.status !== 'ok') return '';
  const n = fmt.int;
  switch (tipo) {
    case 'recarregar': return n(r.leads) + ' leads · ' + n(r.mensagens) + ' mensagens · ' + n(r.vendedores) + ' vendedores';
    case 'pipeline': return (r.simulacao ? 'Moveria ' + n(r.moveria) : 'Moveu ' + n(r.movidos)) + ' de ' + n(r.analisados) + ' leads analisados'
      + (r.revisao_humana ? ' · ' + n(r.revisao_humana) + ' para revisão humana' : '') + (r.reconciliados ? ' · ' + n(r.reconciliados) + ' corrigidos de Aguardando' : '');
    case 'aguardando': return n(r.em_aguardando) + ' em Aguardando · ' + (r.simulacao ? 'moveria ' + n(r.moveria) : 'moveu ' + n(r.movidos)) + (r.falhas ? ' · ' + n(r.falhas) + ' falhas' : '') + ' · ' + n(r.conversas) + ' conversas olhadas';
    case 'etapas': return n(r.etapas) + ' etapas atualizadas';
    case 'anuncio_origem': return r.nada ? 'Nenhum lead pendente' : (r.simulacao ? 'Gravaria em ' : 'Gravou em ') + n(r.contatos) + ' contatos e ' + n(r.oportunidades) + ' oportunidades' + (r.falhas ? ' · ' + n(r.falhas) + ' falhas' : '');
    case 'relatorio_ia': return r.enviado ? 'Relatório gerado e enviado no WhatsApp' : 'Relatório gerado (não enviado)';
    default: return '';
  }
};
/* Detalhe expansível de uma conta */
const detalheItem = (tipo, it) => {
  const r = it.resultado || {};
  if (tipo === 'pipeline' && r.detalhes?.length) {
    const lin = r.detalhes.filter((d) => d.para || d.decisao === 'REVISAO_HUMANA');
    const outros = r.detalhes.length - lin.length;
    return el('div', {},
      lin.length ? el('div', { class: 'lu-auto-scroll' }, el('table', { class: 'lu-table lu-auto-det' }, el('thead', {}, el('tr', {}, ...['Lead', 'De', 'Para', 'Confiança', 'Motivo'].map((t) => el('th', { class: 'txt', text: t })))),
        el('tbody', {}, ...lin.map((d) => el('tr', {}, el('td', { class: 'txt name', text: d.lead }), el('td', { class: 'txt', text: d.de || '—' }),
          el('td', { class: 'txt', text: d.para || 'revisão humana' }), el('td', { text: fmt.pct(100 * (Number(d.confianca) || 0)) }), el('td', { class: 'txt muted wrap', text: d.motivo || '' }))))))
        : el('p', { class: 'lu-help', text: 'Nenhum lead para mover.' }),
      outros ? el('p', { class: 'lu-help', text: outros === 1 ? '1 lead analisado ficou onde estava.' : fmt.int(outros) + ' leads analisados ficaram onde estavam.' }) : '');
  }
  if (tipo === 'aguardando' && r.exemplos?.length) return el('p', { class: 'lu-help', text: 'Oportunidades que seriam movidas: ' + r.exemplos.join(', ') });
  if (tipo === 'relatorio_ia' && r.texto) {
    return el('div', {}, el('div', { class: 'lu-wa' }, el('div', { class: 'lu-bubble', style: 'white-space:pre-wrap', text: r.texto })),
      el('button', { class: 'lu-ghost sm', type: 'button', 'data-copiar': '1', text: 'Copiar texto' }));
  }
  if (tipo === 'etapas' && r.nomes?.length) return el('p', { class: 'lu-help', text: r.nomes.join(' → ') });
  if (tipo === 'anuncio_origem' && (r.campos_criados?.length || r.campos_ausentes?.length)) return el('p', { class: 'lu-help', text: (r.campos_criados?.length ? 'Campos criados: ' + r.campos_criados.join(', ') + '. ' : '') + (r.campos_ausentes?.length ? 'Campos ausentes: ' + r.campos_ausentes.join(', ') : '') });
  return null;
};
/* Totais do relatório final */
const totais = (tipo, itens) => {
  const ok = itens.filter((i) => i.status === 'ok'), s = (k) => ok.reduce((t, i) => t + (Number(i.resultado?.[k]) || 0), 0);
  const sim = ok.some((i) => i.resultado?.simulacao);
  switch (tipo) {
    case 'recarregar': return [['Leads regravados', s('leads')], ['Mensagens', s('mensagens')]];
    case 'pipeline': return [[sim ? 'Seriam movidos' : 'Movidos', sim ? s('moveria') : s('movidos')], ['Analisados', s('analisados')], ['Revisão humana', s('revisao_humana')]];
    case 'aguardando': return [[sim ? 'Seriam movidos' : 'Movidos', sim ? s('moveria') : s('movidos')], ['Em Aguardando', s('em_aguardando')]];
    case 'etapas': return [['Etapas', s('etapas')]];
    case 'anuncio_origem': return [[sim ? 'Contatos a gravar' : 'Contatos gravados', s('contatos')], ['Oportunidades', s('oportunidades')]];
    case 'relatorio_ia': return [['Relatórios', ok.length], ['Enviados', ok.filter((i) => i.resultado?.enviado).length]];
    default: return [];
  }
};

/* Tempo estimado: média das contas já feitas nesta execução; senão o histórico da conta; senão o padrão */
const estimativa = (ex, catalogo) => {
  const itens = ex.itens || [];
  const feitos = itens.filter((i) => i.status === 'ok' && i.iniciado_em && i.concluido_em);
  const mediaRun = feitos.length ? feitos.reduce((t, i) => t + segEntre(i.iniciado_em, i.concluido_em), 0) / feitos.length : null;
  const cat = catalogo.find((c) => c.tipo === ex.tipo);
  const est = (i) => mediaRun ?? (Number(i.media_seg) || Number(cat?.media_seg) || PADRAO_SEG[ex.tipo] || 60);
  const total = itens.length || 1;
  let feitosN = 0, frac = 0, resta = 0, atual = null;
  for (const i of itens) {
    if (itemFeito(i.status)) { feitosN++; continue; }
    if (i.status === 'executando') {
      const e = est(i), dec = segEntre(i.iniciado_em);
      frac = Math.min(0.95, dec / e); resta += Math.max(e - dec, 5); atual = { ...i, decorrido: dec, previsto: e };
    } else resta += est(i);
  }
  return { pct: Math.min(100, 100 * (feitosN + frac) / total), feitos: feitosN, total, resta, atual };
};

export const renderAutomacoes = async (main, ctx) => {
  main.replaceChildren(clone('tpl-automacoes'));
  const form = $('.f-auto', main), selTipo = $('.f-tipo', main), slotCampos = $('.slot-campos', main), slotExec = $('.slot-exec', main);
  const lista = $('.f-lojas', main), busca = $('.f-lojas-q', main), contagem = $('.f-contagem', main), simBox = $('.f-sim-box', main), sim = $('.f-sim', main);
  const msg = $('.lu-msg', form), tbHist = $('#tb-auto tbody', main);
  let catalogo = [], atualId = null, timer = null, vivo = true;
  const lojas = [...(ctx.me.lojas || [])].sort((a, b) => String(a.loja).localeCompare(String(b.loja), 'pt-BR'));

  /* ---------- Formulário ---------- */
  lista.replaceChildren(...lojas.map((l) => el('label', { 'data-nome': String(l.loja).toLowerCase(), title: String(l.loja) },
    el('input', { type: 'checkbox', class: 'lu-check', name: 'lojas', value: l.loja_id }), el('span', { text: String(l.loja).trim() }))),
    el('p', { class: 'vazio', hidden: true, text: 'Nenhuma conta encontrada.' }));
  const marcadas = () => $$('input[name=lojas]:checked', lista).map((i) => Number(i.value));
  const atualizarEst = () => {
    const n = marcadas().length, c = catalogo.find((x) => x.tipo === selTipo.value);
    contagem.replaceChildren(n ? el('b', { text: String(n) }) : '', n === 0 ? 'Nenhuma selecionada' : n === 1 ? ' conta selecionada' : ' contas selecionadas');
    const media = Number(c?.media_seg) || PADRAO_SEG[selTipo.value] || 60;
    $('.slot-est', main).textContent = n ? 'Tempo estimado: cerca de ' + dur(n * media) + (c?.media_seg ? ' (média de ' + dur(media) + ' por conta nas últimas execuções)' : ' (estimativa inicial; fica mais precisa depois das primeiras execuções)') + '.' : '';
  };
  lista.addEventListener('change', atualizarEst);
  busca.addEventListener('input', () => {
    const t = busca.value.trim().toLowerCase(); let vis = 0;
    $$('label', lista).forEach((l) => { l.hidden = !!t && !l.dataset.nome.includes(t); if (!l.hidden) vis++; });
    $('.vazio', lista).hidden = vis > 0;
  });
  const marcarVisiveis = (v) => { $$('label:not([hidden]) input[name=lojas]', lista).forEach((i) => { i.checked = v; }); atualizarEst(); };
  $('.act-todas', main).onclick = () => marcarVisiveis(true);
  $('.act-nenhuma', main).onclick = () => marcarVisiveis(false);

  const montarCampos = () => {
    const c = catalogo.find((x) => x.tipo === selTipo.value);
    if (!c) return;
    $('.slot-desc', main).textContent = c.descricao;
    slotCampos.replaceChildren(...(c.campos || []).flatMap((k) => (CAMPOS[k] ? CAMPOS[k](c) : [])));
    slotCampos.hidden = !slotCampos.children.length;
    simBox.hidden = !c.simulacao; sim.checked = !!c.simulacao;
    atualizarEst();
  };
  selTipo.addEventListener('change', montarCampos);

  const lerParams = () => {
    const p = {};
    for (const i of $$('input,select', slotCampos)) p[i.name] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value;
    return p;
  };
  const dlg = $('#dlg-auto');
  const confirmar = (titulo, sub, aviso) => new Promise((res) => {
    $('#dlg-auto-t').textContent = titulo; $('.slot-sub', dlg).textContent = sub; $('.slot-aviso', dlg).textContent = aviso;
    const fim = (v) => { dlg.close(); res(v); };
    $$('.act-cancelar', dlg).forEach((b) => { b.onclick = () => fim(false); });
    $('.act-confirmar', dlg).onclick = () => fim(true);
    dlg.onclose = () => res(false);
    dlg.showModal();
  });
  const criar = async (tipo, lojasIds, params, simulacao, origem) => {
    const c = catalogo.find((x) => x.tipo === tipo);
    const mexe = ['pipeline', 'aguardando', 'anuncio_origem'].includes(tipo) || (tipo === 'relatorio_ia' && params.enviar);
    if (!simulacao && mexe) {
      const ok = await confirmar('Rodar de verdade?', c.nome + ' em ' + lojasIds.length + (lojasIds.length === 1 ? ' conta' : ' contas'),
        tipo === 'relatorio_ia' ? 'O relatório de cada conta será enviado no WhatsApp.' : 'Isto altera o CRM (GHL) das contas escolhidas e não dá para desfazer por aqui. Se ainda não rodou a simulação, cancele e rode primeiro em simulação.');
      if (!ok) return null;
    }
    return rpc('atend_admin_auto_criar', { p_tipo: tipo, p_lojas: lojasIds, p_params: params, p_simulacao: simulacao, p_origem: origem || null });
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); msg.hidden = true;
    const ids = marcadas();
    if (!ids.length) { msg.textContent = 'Escolha pelo menos uma conta.'; msg.hidden = false; return; }
    const btn = $('.act-rodar', form); btn.disabled = true;
    try {
      const id = await criar(selTipo.value, ids, lerParams(), !simBox.hidden && sim.checked);
      if (id) { toast('Automação na fila. Começa em até 1 minuto.'); abrir(Number(id)); historico(); }
    } catch (er) { msg.textContent = er.message; msg.hidden = false; }
    btn.disabled = false;
  });

  /* ---------- Execução: progresso e relatório ---------- */
  const desenhar = (ex) => {
    const cat = catalogo.find((c) => c.tipo === ex.tipo) || {};
    const itens = ex.itens || [], est = estimativa(ex, catalogo);
    const head = el('div', { class: 'lu-card-head' },
      el('div', {}, el('h3', {}, ex.nome || ex.tipo, ' ', ex.simulacao ? el('span', { class: 'lu-pill', text: 'simulação' }) : ''),
        el('p', { text: '#' + ex.id + ' · pedida por ' + (ex.por || '—') + ' em ' + fmt.dt(ex.criado_em) + (ex.params?.inicio ? ' · ' + fmt.dmy(ex.params.inicio) + (ex.params.fim && ex.params.fim !== ex.params.inicio ? ' a ' + fmt.dmy(ex.params.fim) : '') : '') })),
      pill(ex.status));
    const blocos = [head];
    if (ex.status === 'pendente') {
      blocos.push(el('p', { class: 'lu-help', text: Number(ex.na_fila_antes) ? 'Na fila: ' + ex.na_fila_antes + (Number(ex.na_fila_antes) === 1 ? ' automação antes desta.' : ' automações antes desta.') : 'Aguardando o n8n pegar (até 1 minuto).' }));
    }
    if (!ehFim(ex.status) || ex.status === 'cancelado' || ex.status === 'falhou') {
      const pct = ehFim(ex.status) ? 100 * est.feitos / est.total : est.pct;
      blocos.push(el('div', { class: 'lu-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct), 'aria-label': 'Progresso' },
        el('i', { style: 'width:' + pct.toFixed(1) + '%' })));
      const linha = [fmt.int(est.feitos) + ' de ' + fmt.int(est.total) + (est.total === 1 ? ' conta' : ' contas'), Math.round(pct) + '%'];
      if (ex.status === 'executando') {
        linha.push('rodando há ' + dur(segEntre(ex.iniciado_em)));
        linha.push('faltam cerca de ' + dur(est.resta));
      }
      blocos.push(el('p', { class: 'lu-auto-linha', text: linha.join(' · ') }));
      if (est.atual) blocos.push(el('p', { class: 'lu-help' }, 'Agora: ', el('b', { text: String(est.atual.rotulo).trim() }), ' · há ' + dur(est.atual.decorrido) + ' (previsto ' + dur(est.atual.previsto) + ')'));
    }
    if (ex.erro) blocos.push(el('div', { class: 'lu-fail', text: ex.erro }));
    if (ehFim(ex.status)) {
      const t = totais(ex.tipo, itens), nOk = itens.filter((i) => i.status === 'ok').length, nF = itens.filter((i) => i.status === 'falhou').length, nI = itens.filter((i) => i.status === 'ignorado').length;
      blocos.push(el('div', { class: 'lu-auto-tot' },
        ...[['Contas ok', nOk], ...(nF ? [['Com falha', nF]] : []), ...(nI ? [['Puladas', nI]] : []), ...t, ['Duração', null]].map(([k, v]) =>
          el('div', {}, el('b', { text: v === null ? dur(segEntre(ex.iniciado_em, ex.concluido_em)) : fmt.int(v) }), el('span', { text: k })))));
    }
    if (!ehFim(ex.status)) blocos.push(el('div', { class: 'lu-actions', style: 'justify-content:flex-start' }, el('button', { class: 'lu-ghost sm act-cancelar-exec', type: 'button', text: 'Cancelar as contas que faltam' })));
    if (ex.status === 'concluido' && ex.simulacao) {
      blocos.push(el('div', { class: 'lu-auto-real' }, el('p', { text: 'Gostou do resultado da simulação? Rode a mesma automação de verdade nas mesmas contas.' }),
        el('button', { class: 'lu-primary act-real', type: 'button', text: 'Executar de verdade' })));
    }
    // Contas
    blocos.push(el('div', { class: 'lu-auto-itens' }, ...itens.map((i) => {
      const det = i.status === 'ok' ? detalheItem(ex.tipo, i) : null;
      const linha = el('div', { class: 'lu-auto-item ' + i.status },
        el('div', { class: 'nm' }, el('b', { text: String(i.rotulo).trim() }), el('small', { text: resumoItem(ex.tipo, i) || (i.status === 'executando' ? 'Rodando…' : i.status === 'pendente' ? 'Aguardando a vez' : '') })),
        el('span', { class: 'tm', text: i.iniciado_em ? dur(segEntre(i.iniciado_em, i.concluido_em)) : '' }), pill(i.status));
      return det ? el('details', { class: 'lu-auto-det-box' }, el('summary', {}, linha), det) : linha;
    })));
    slotExec.replaceChildren(...blocos);
    $('.act-cancelar-exec', slotExec)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await rpc('atend_admin_auto_cancelar', { p_id: ex.id }); toast('Cancelando: a conta que está rodando termina e as outras são puladas.'); atualizar(); } catch (er) { toast(er.message, true); e.target.disabled = false; }
    });
    $('.act-real', slotExec)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const id = await criar(ex.tipo, itens.map((i) => Number(i.loja_id)).filter(Boolean), ex.params || {}, false, ex.id);
        if (id) { toast('Execução de verdade na fila.'); abrir(Number(id)); historico(); } else e.target.disabled = false;
      } catch (er) { toast(er.message, true); e.target.disabled = false; }
    });
    $$('[data-copiar]', slotExec).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); copiar(b.previousElementSibling.textContent); }));
  };
  const atualizar = async () => {
    if (!atualId || !vivo) return;
    clearTimeout(timer);
    try {
      const ex = await rpc('atend_admin_auto_status', { p_id: atualId });
      // não redesenha um detalhe que a pessoa abriu
      const abertos = $$('details[open] .nm b', slotExec).map((b) => b.textContent);
      desenhar(ex);
      $$('details', slotExec).forEach((d) => { if (abertos.includes($('.nm b', d)?.textContent)) d.open = true; });
      if (!ehFim(ex.status)) timer = setTimeout(atualizar, ex.status === 'executando' ? 3000 : 5000);
      else historico();
    } catch (er) { slotExec.replaceChildren(el('div', { class: 'lu-fail', text: er.message })); }
  };
  const abrir = (id) => {
    atualId = id;
    try { localStorage.setItem('lu-auto-ultima', String(id)); } catch { /* sem storage */ }
    atualizar();
    if (window.innerWidth < 900) slotExec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------- Histórico ---------- */
  const historico = async () => {
    try {
      const rows = await rpc('atend_admin_auto_lista', { p_limite: 30 }) || [];
      if (!rows.length) { tbHist.replaceChildren(el('tr', {}, el('td', { class: 'txt muted', colspan: 6, text: 'Nenhuma automação rodada pelo painel ainda.' }))); return; }
      tbHist.replaceChildren(...rows.map((r) => el('tr', { 'data-id': r.id, tabindex: 0, class: Number(r.id) === atualId ? 'on' : '' },
        el('td', { class: 'txt mono', text: fmt.dt(r.criado_em) }),
        el('td', { class: 'txt name' }, r.nome || r.tipo, r.simulacao ? el('span', { class: 'lu-pill', style: 'margin-left:6px', text: 'simulação' }) : ''),
        el('td', { class: 'txt muted wrap', text: (String(r.contas || '').replace(/\n/g, '')) + (Number(r.total) > 4 ? ' e mais ' + (r.total - 4) : '') }),
        el('td', { class: 'txt' }, pill(r.status), Number(r.falhas) ? el('small', { class: 'muted', text: ' ' + r.falhas + ' com falha' }) : ''),
        el('td', { text: r.concluido_em ? dur(segEntre(r.iniciado_em, r.concluido_em)) : r.iniciado_em ? fmt.int(r.feitos) + '/' + fmt.int(r.total) : '—' }),
        el('td', { class: 'txt muted hide-sm', text: r.por || '—' }))));
    } catch (er) { tbHist.replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 6 }, el('div', { class: 'lu-fail', text: er.message })))); }
  };
  tbHist.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) abrir(Number(tr.dataset.id)); });
  tbHist.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-id]'); if (tr) abrir(Number(tr.dataset.id)); } });

  /* ---------- Início ---------- */
  try {
    catalogo = await rpc('atend_admin_auto_catalogo') || [];
    selTipo.replaceChildren(...catalogo.map((c) => el('option', { value: c.tipo, text: c.nome })));
    montarCampos();
  } catch (er) { msg.textContent = er.message; msg.hidden = false; }
  await historico();
  let ult = null; try { ult = Number(localStorage.getItem('lu-auto-ultima')) || null; } catch { /* sem storage */ }
  const primeira = $('tr[data-id]', tbHist);
  if (ult && $('tr[data-id="' + ult + '"]', tbHist)) abrir(ult); else if (primeira) abrir(Number(primeira.dataset.id));
  const vis = () => { if (!document.hidden) atualizar(); };
  document.addEventListener('visibilitychange', vis);
  return () => { vivo = false; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
};
