import { $, $$, el, clone, rpc, fmt, isNum, toast, copiar, LOGO } from './core.js?v=202610291203';
import { etapasVisiveis } from './charts.js?v=202610291203';
import { montarFiltros } from './filtros.js?v=202610291203';

const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/* Monta o texto no formato do relatório semanal do WhatsApp */
const montarTexto = (d, o, escopo) => {
  const k = d.kpis;
  const L = [];
  const comp = (v, kind) => (o.comp && isNum(v) ? ` (${fmt.sinal(v, kind)})` : '');
  L.push(`📊 *RELATÓRIO DE ATENDIMENTOS — ${escopo.toUpperCase()}*`);
  L.push(`📅 ${fmt.dmy(k.de)} a ${fmt.dmy(k.ate)}` + (o.comp ? `\n↔️ Comparado com ${fmt.dmy(k.de_ant)} a ${fmt.dmy(k.ate_ant)}` : ''));
  L.push('');
  L.push('📈 *INDICADORES*');
  L.push(`Novos atendimentos: *${fmt.int(k.atendimentos)}*` + comp(k.var_atendimentos, 'pct'));
  L.push(`Taxa de resposta: ${fmt.pct(k.taxa_resposta)}` + comp(k.var_taxa_resposta, 'pp'));
  L.push(`Respondidos no SLA de ${fmt.int(k.sla_min)} min: ${fmt.pct(k.taxa_sla)}` + comp(k.var_taxa_sla, 'pp'));
  L.push(`Primeira resposta média: ${fmt.min(k.tempo_medio_min)}` + (isNum(k.tempo_mediano_min) ? ` (mediana ${fmt.min(k.tempo_mediano_min)})` : ''));
  L.push(`Sem resposta: ${fmt.int(k.sem_resposta)}` + comp(k.var_sem_resposta, 'abs'));
  const vt = Math.max(Number(k.vendas) || 0, Number(k.vendas_etapa) || 0), vta = Math.max(Number(k.vendas_ant) || 0, Number(k.vendas_etapa_ant) || 0);
  L.push(`Vendas: *${fmt.int(vt)}*` + comp(vt - vta, 'abs') + (Number(k.vendas) !== Number(k.vendas_etapa) ? ` — ${fmt.int(k.vendas)} ganhas no CRM, ${fmt.int(k.vendas_etapa)} em etapa de venda` : ''));
  if (o.inv && d.inv?.total && Number(d.inv.total.empresas)) {
    const t = d.inv.total;
    L.push('', '💰 *INVESTIMENTO*');
    L.push(`Investido em anúncios: *${fmt.brl(t.investimento)}*` + comp(t.var_investimento, 'pct'));
    L.push(`Custo por atendimento: *${fmt.brl(t.custo_atend)}*` + (o.comp && isNum(t.custo_atend_ant) ? ` (antes ${fmt.brl(t.custo_atend_ant)})` : ''));
    if (isNum(t.custo_venda)) L.push(`Custo por venda: ${fmt.brl(t.custo_venda)}`);
    if (Number(t.empresas_sem_dados)) L.push(`_Sem dados do Meta no período: ${(t.nomes_sem_dados || []).join(', ')}_`);
  }
  if (o.ads && d.ads?.veiculos?.length) {
    L.push('', '🚗 *VEÍCULOS QUE MAIS TROUXERAM LEADS*');
    for (const v of d.ads.veiculos.slice(0, 5)) L.push(`• ${v.veiculo}: ${fmt.int(v.leads)} leads` + (Number(v.avancaram) ? ` (${fmt.int(v.avancaram)} avançaram)` : '') + (Number(v.vendas) ? ` · ${fmt.int(v.vendas)} vendas` : ''));
  }

  if (o.funil && d.etapas?.length) {
    const et = etapasVisiveis(d.etapas, 12).filter((e) => Number(e.leads) > 0);
    if (et.length) {
      L.push('', '🔄 *MOVIMENTO NO FUNIL*', 'Leads que entraram em cada etapa, na ordem do funil');
      for (const e of et) L.push(`• ${e.etapa}: ${fmt.int(e.leads)}` + (o.comp ? ` (antes ${fmt.int(e.leads_ant)})` : ''));
    }
  }
  if (o.lojas && d.porLoja?.length > 1) {
    L.push('', '🏪 *LOJAS*');
    d.porLoja.filter((l) => Number(l.atendimentos) > 0).slice(0, 15).forEach((l, i) => {
      const lv = Math.max(Number(l.vendas) || 0, Number(l.vendas_etapa) || 0);
      L.push(`${i + 1}. *${l.loja}* — ${fmt.int(l.atendimentos)} atendimentos | SLA ${fmt.pct(l.taxa_sla)} | 1ª resp. ${fmt.min(l.tempo_medio_min)}` + (lv ? ` | ${fmt.int(lv)} ${lv === 1 ? 'venda' : 'vendas'}` : ''));
    });
  }
  if (o.vend && d.vendedores?.length) {
    const v = d.vendedores.filter((x) => Number(x.atendimentos) > 0).slice(0, escopo.multi ? 15 : 30);
    if (v.length) {
      L.push('', d.vendedores.length === 1 ? '👤 *VENDEDOR*' : '👥 *VENDEDORES*');
      for (const x of v) {
        L.push(`*${x.vendedor}*` + (escopo.multi ? ` (${x.loja})` : '') + ` — ${fmt.int(x.atendimentos)} atendimentos` + (o.comp && isNum(x.var_atendimentos) ? ` (${fmt.sinal(x.var_atendimentos, 'pct')})` : ''));
        L.push(`Resposta ${fmt.pct(x.taxa_resposta)} | SLA ${fmt.pct(x.taxa_sla)} | 1ª resposta ${fmt.min(x.tempo_medio_min)}` + (Math.max(Number(x.vendas) || 0, Number(x.vendas_etapa) || 0) ? ` | ${fmt.int(Math.max(Number(x.vendas) || 0, Number(x.vendas_etapa) || 0))} ${Math.max(Number(x.vendas) || 0, Number(x.vendas_etapa) || 0) === 1 ? 'venda' : 'vendas'}` : ''));
      }
    }
  }
  if (o.horas && d.horarios?.length) {
    const top = [...d.horarios].sort((a, b) => Number(b.atendimentos) - Number(a.atendimentos))[0];
    const porDia = {};
    for (const h of d.horarios) porDia[h.dia_semana] = (porDia[h.dia_semana] || 0) + Number(h.atendimentos);
    const diaTop = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0];
    L.push('', '⏰ *HORÁRIO DE PICO*');
    L.push(`Faixa com mais leads: ${DIAS[top.dia_semana]}, ${top.hora}h–${Number(top.hora) + 1}h (${fmt.int(top.atendimentos)})`);
    if (diaTop) L.push(`Dia com mais leads: ${DIAS[diaTop[0]]} (${fmt.int(diaTop[1])})`);
  }
  if (o.obs) L.push('', '📝 ' + o.obs);
  L.push('', '_Dashboard de Atendimentos · Level Up_');
  return L.join('\n');
};

/* Prévia com a formatação do WhatsApp (*negrito* e _itálico_), montada sem HTML */
const previa = (alvo, texto) => {
  alvo.replaceChildren();
  const re = /\*([^*\n]+)\*|_([^_\n]+)_/g;
  let i = 0, m;
  while ((m = re.exec(texto))) {
    if (m.index > i) alvo.append(texto.slice(i, m.index));
    alvo.append(m[1] !== undefined ? el('b', { text: m[1] }) : el('i', { text: m[2] }));
    i = re.lastIndex;
  }
  if (i < texto.length) alvo.append(texto.slice(i));
};

export const renderRelatorio = async (main, ctx) => {
  main.replaceChildren(clone('tpl-relatorio'));
  const f = ctx.filtros, me = ctx.me;
  montarFiltros($('.slot-filtros', main), ctx, 'relatorio');
  const multi = !f.conta && me.lojas.length > 1;
  const nomeLoja = f.conta ? (me.lojas.find((l) => Number(l.loja_id) === Number(f.conta)) || {}).loja : me.lojas.length === 1 ? me.lojas[0].loja : 'Todas as lojas';
  const escopo = Object.assign(new String(nomeLoja || 'Loja'), { multi });

  const texto = $('.o-texto', main), prev = $('.o-preview', main), wa = $('.act-wa', main);
  const opts = { comp: $('.o-comp', main), funil: $('.o-funil', main), vend: $('.o-vend', main), lojas: $('.o-lojas', main), horas: $('.o-horas', main), inv: $('.o-inv', main), ads: $('.o-ads', main), obs: $('.o-obs', main) };
  if (!multi) opts.lojas.closest('label').hidden = true;
  $('.o-hora', main).textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());

  const atualizarSaida = () => {
    previa(prev, texto.value);
    wa.href = 'https://wa.me/?text=' + encodeURIComponent(texto.value);
  };
  texto.addEventListener('input', atualizarSaida);

  texto.value = 'Carregando os dados…'; texto.disabled = true; atualizarSaida();
  $('.slot-meta', main).replaceChildren(el('span', {}, 'Loja: ', el('b', { text: String(nomeLoja) })), el('span', {}, 'Período: ', el('b', { text: fmt.dmy(f.inicio) + ' a ' + fmt.dmy(f.fim) })));

  const args = { p_inicio: f.inicio, p_fim: f.fim, p_conta: f.conta };
  let dados;
  try {
    const [kpis, etapas, vendedores, horarios, porLoja, inv, ads] = await Promise.all([
      rpc('atend_kpis', args), rpc('atend_etapas', args), rpc('atend_vendedores', args), rpc('atend_horarios', args),
      multi ? rpc('atend_por_loja', { p_inicio: f.inicio, p_fim: f.fim }) : Promise.resolve([]),
      rpc('atend_investimento', args).catch(() => null), rpc('atend_anuncios', args).catch(() => null),
    ]);
    dados = { kpis: kpis?.[0], etapas, vendedores, horarios, porLoja, inv, ads };
    if (!inv?.total || !Number(inv.total.empresas)) opts.inv.closest('label').hidden = true;
    if (!ads?.veiculos?.length) opts.ads.closest('label').hidden = true;
    if (!dados.kpis) throw new Error('Sem dados para o período.');
  } catch (e) {
    texto.value = 'Não foi possível montar o relatório: ' + e.message; texto.disabled = false; atualizarSaida();
    toast(e.message, true); return;
  }

  let editado = false;
  texto.addEventListener('input', () => { editado = true; }, { once: true });
  const gerar = (forcar) => {
    if (editado && !forcar) return;
    texto.value = montarTexto(dados, { comp: opts.comp.checked, funil: opts.funil.checked, vend: opts.vend.checked, lojas: opts.lojas.checked, horas: opts.horas.checked, inv: opts.inv.checked, ads: opts.ads.checked, obs: opts.obs.value.trim() }, escopo);
    texto.disabled = false; editado = false;
    texto.addEventListener('input', () => { editado = true; }, { once: true });
    atualizarSaida();
  };
  const aoMudarOpcao = () => {
    if (editado) { toast('Você editou o texto. Use “Gerar de novo” para aplicar as opções (suas edições serão substituídas).'); return; }
    gerar(true);
  };
  for (const k of ['comp', 'funil', 'vend', 'lojas', 'horas', 'inv', 'ads']) opts[k].addEventListener('change', aoMudarOpcao);
  opts.obs.addEventListener('input', aoMudarOpcao);
  $('.act-gerar', main).addEventListener('click', () => gerar(true));
  $('.act-copiar', main).addEventListener('click', () => copiar(texto.value));
  $('.act-baixar', main).addEventListener('click', () => {
    const a = el('a', { href: URL.createObjectURL(new Blob([texto.value], { type: 'text/plain;charset=utf-8' })), download: `relatorio-${String(nomeLoja).toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${f.inicio}-a-${f.fim}.txt` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('.act-pdf', main).addEventListener('click', () => imprimir(texto.value, String(nomeLoja), f));
  gerar(true);
  return envio(main, ctx, texto);
};

/* ---------- PDF (impressão do navegador → Salvar como PDF) ---------- */
const imprimir = (valor, loja, f) => {
  const area = $('#print-area');
  area.replaceChildren();
  const head = el('header', { class: 'pr-head' });
  head.innerHTML = LOGO('lu-logo-print', 'pr-logo');
  head.append(el('div', {}, el('b', { text: 'Dashboard de Atendimentos · Level Up' }), el('span', { text: loja + ' · ' + fmt.dmy(f.inicio) + ' a ' + fmt.dmy(f.fim) })));
  const corpo = el('div', { class: 'pr-body' });
  previa(corpo, valor);
  area.append(head, corpo, el('footer', { class: 'pr-foot', text: 'Gerado em ' + new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()) }));
  const titulo = document.title;
  document.title = 'Relatorio ' + loja + ' ' + f.inicio + ' a ' + f.fim;
  const fim = () => { document.title = titulo; area.replaceChildren(); window.removeEventListener('afterprint', fim); };
  window.addEventListener('afterprint', fim);
  window.print();
};

/* ---------- Envio pelo WhatsApp da Level Up ---------- */
const STATUS = { pendente: ['warn', 'na fila'], enviando: ['warn', 'enviando'], enviado: ['ok', 'enviado'], falhou: ['bad', 'falhou'], incerto: ['bad', 'sem confirmação'] };
const pillStatus = (s) => { const [c, t] = STATUS[s] || ['', s || '—']; return el('span', { class: 'lu-pill ' + c, text: t }); };

const envio = async (main, ctx, texto) => {
  const sel = $('.o-destino', main), btn = $('.act-enviar', main), info = $('.slot-envio', main), tbody = $('#tb-envios tbody', main);
  let timer = null, destinos = null;
  const nomeDestino = (r) => r.destino || '—';
  const historico = async () => {
    try {
      const rows = await rpc('atend_admin_envios') || [];
      if (!rows.length) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt muted', colspan: 5, text: 'Nenhuma mensagem enviada pelo painel ainda.' }))); return rows; }
      tbody.replaceChildren(...rows.map((r) => el('tr', {},
        el('td', { class: 'txt mono', text: fmt.dt(r.enviado_em || r.criado_em) }),
        el('td', { class: 'txt name', text: nomeDestino(r) }),
        el('td', { class: 'txt' }, pillStatus(r.status), r.erro ? el('div', { class: 'muted wrap', style: 'font-size:12px;margin-top:4px', text: r.erro }) : null),
        el('td', { class: 'txt hide-sm muted', text: r.por || '—' }),
        el('td', { class: 'txt hide-sm muted wrap', text: String(r.inicio || '').replace(/[*_]/g, '') })))); 
      return rows;
    } catch (e) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 5 }, el('div', { class: 'lu-fail', text: e.message })))); return []; }
  };
  const acompanhar = (id, para) => {
    clearTimeout(timer);
    let n = 0;
    const passo = async () => {
      if (!main.isConnected) return;
      let r = null;
      try { r = (await rpc('atend_admin_envios', { p_id: id }) || [])[0]; } catch { /* tenta de novo */ }
      const st = r?.status || 'pendente';
      info.hidden = false; info.className = 'lu-msg ' + (st === 'enviado' ? 'ok' : st === 'falhou' || st === 'incerto' ? 'erro' : 'info');
      info.replaceChildren();
      if (st === 'enviado') info.append(el('b', { text: 'Mensagem enviada ' }), 'para ' + para + '.');
      else if (st === 'falhou') info.append(el('b', { text: 'Não foi enviada. ' }), r?.erro || 'O WhatsApp recusou a mensagem.');
      else if (st === 'incerto') info.append(el('b', { text: 'Sem confirmação do WhatsApp. ' }), 'Confira o grupo antes de enviar de novo.');
      else info.append(el('b', { text: st === 'enviando' ? 'Enviando… ' : 'Na fila. ' }), 'A automação envia em até 1 minuto.');
      if (['pendente', 'enviando'].includes(st) && ++n < 40) timer = setTimeout(passo, 6000);
      else historico();
    };
    passo();
  };

  try {
    destinos = await rpc('atend_admin_destinos');
    const grupos = destinos?.grupos || [];
    if (!grupos.length) {
      sel.replaceChildren(el('option', { value: '', text: 'Nenhum grupo de CRM encontrado ainda' })); btn.disabled = true;
    } else {
      sel.replaceChildren(el('option', { value: '', text: 'Escolha o grupo de CRM…' }),
        ...grupos.map((g) => el('option', { value: g.jid, text: String(g.nome).replace(/^[^A-Za-z0-9À-ú]+/, '').trim() })));
      const daLoja = grupos.filter((g) => ctx.filtros.conta && (g.lojas || []).map(Number).includes(Number(ctx.filtros.conta)));
      if (daLoja.length === 1) sel.value = daLoja[0].jid;
    }
  } catch (e) { sel.replaceChildren(el('option', { value: '', text: 'Não foi possível carregar os grupos' })); btn.disabled = true; }

  const dlg = $('#dlg-enviar');
  btn.addEventListener('click', () => {
    const v = sel.value, msg = texto.value.trim();
    if (!v) return toast('Escolha o grupo de CRM.', true);
    if (msg.length < 20 || texto.disabled) return toast('A mensagem ainda não está pronta.', true);
    const para = sel.selectedOptions[0]?.textContent || '';
    $('.slot-para', dlg).textContent = 'Para: ' + para;
    previa($('.slot-previa', dlg), msg);
    dlg.showModal();
    $$('.act-cancelar', dlg).forEach((b) => { b.onclick = () => dlg.close(); });
    const ok = $('.act-confirmar', dlg);
    ok.disabled = false;
    ok.onclick = async () => {
      ok.disabled = true;
      try {
        const r = await rpc('atend_admin_enviar', { p_grupo: v, p_texto: msg });
        dlg.close(); toast('Mensagem colocada na fila de envio.');
        acompanhar(r.id, para); historico();
      } catch (e) { toast(e.message, true); ok.disabled = false; }
    };
  });
  await historico();
  return () => clearTimeout(timer);
};
