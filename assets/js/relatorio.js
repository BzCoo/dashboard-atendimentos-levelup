import { $, $$, el, clone, rpc, fmt, isNum, toast, copiar, LOGO, metaPara, sb } from './core.js?v=202611161757';
import { diagnosticar, textoPlano } from './plano.js?v=202611161757';
import { etapasVisiveis } from './charts.js?v=202611161757';
import { N8N_GRUPOS } from './config.js?v=202611161757';
import { montarFiltros } from './filtros.js?v=202611161757';

const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/* Monta o texto no formato do relatório semanal do WhatsApp (enxuto: uma linha por assunto) */
const montarTexto = (d, o, escopo) => {
  const k = d.kpis;
  const L = [];
  const comp = (v, kind) => (o.comp && isNum(v) ? ` (${fmt.sinal(v, kind)})` : '');
  const vendas = (x) => Math.max(Number(x.vendas) || 0, Number(x.vendas_etapa) || 0);
  L.push(`📊 *RELATÓRIO — ${escopo.toUpperCase()}*`);
  L.push(`📅 ${fmt.dmy(k.de)} a ${fmt.dmy(k.ate)}` + (o.comp ? ` (comparado com ${fmt.dmy(k.de_ant)} a ${fmt.dmy(k.ate_ant)})` : ''));
  L.push('');
  const vt = vendas(k), vta = Math.max(Number(k.vendas_ant) || 0, Number(k.vendas_etapa_ant) || 0);
  L.push(`Leads: *${fmt.int(k.atendimentos)}*` + comp(k.var_atendimentos, 'pct') + ` · Vendas: *${fmt.int(vt)}*` + comp(vt - vta, 'abs'));
  L.push(`Respondidos: ${fmt.pct(k.taxa_resposta)}` + comp(k.var_taxa_resposta, 'pp') + ` · No SLA (${fmt.int(k.sla_min)} min): ${fmt.pct(k.taxa_sla)}` + comp(k.var_taxa_sla, 'pp'));
  L.push(`1ª resposta média: ${fmt.min(k.tempo_medio_min)} · Sem resposta: ${fmt.int(k.sem_resposta)}` + comp(k.var_sem_resposta, 'abs'));

  if (o.traf && d.traf?.atual && Number(d.traf.atual.leads)) {
    const a = d.traf.atual, b = d.traf.anterior || {}, n = Number(a.leads), tot = Number(a.leads_total) || 0;
    const varPct = Number(b.leads) ? (100 * (n - Number(b.leads))) / Number(b.leads) : null;
    const ts = Number(a.respondidos) ? (100 * Number(a.dentro_sla)) / Number(a.respondidos) : null;
    L.push('', '📣 *TRÁFEGO (INSTAGRAM + FACEBOOK)*');
    L.push(`*${fmt.int(n)}* leads` + comp(varPct, 'pct') + (tot ? `, ${fmt.pct((100 * n) / tot)} do total` : '') + ` · IG ${fmt.int(a.instagram)} · FB ${fmt.int(a.facebook)}`);
    L.push(`Respondidos: ${fmt.pct((100 * Number(a.respondidos)) / n)}` + (isNum(ts) ? ` · No SLA: ${fmt.pct(ts)}` : '') + ` · Sem resposta: ${fmt.int(a.sem_resposta)}` + (Number(a.vendas) ? ` · Vendas: ${fmt.int(a.vendas)}` : ''));
    const lj = (d.traf.por_loja || []).filter((x) => Number(x.leads) > 0);
    if (escopo.multi && lj.length > 1) L.push('Mais tráfego: ' + lj.slice(0, 5).map((x) => `${x.loja} ${fmt.int(x.leads)}`).join(' · '));
  }
  if (o.inv && d.inv?.total && Number(d.inv.total.empresas)) {
    const t = d.inv.total;
    L.push('', '💰 *INVESTIMENTO*');
    L.push(`*${fmt.brl(t.investimento)}*` + comp(t.var_investimento, 'pct') + ` · ${fmt.brl(t.custo_atend)} por lead` + (isNum(t.custo_venda) ? ` · ${fmt.brl(t.custo_venda)} por venda` : ''));
  }
  if (o.ads && d.ads?.veiculos?.length) {
    L.push('', '🚗 *VEÍCULOS QUE MAIS TROUXERAM LEADS*');
    L.push(d.ads.veiculos.slice(0, 3).map((v) => `${v.veiculo} (${fmt.int(v.leads)})`).join(' · '));
  }
  if (o.funil && d.etapas?.length) {
    const et = etapasVisiveis(d.etapas, 12).filter((e) => Number(e.leads) > 0).slice(0, 6);
    if (et.length) {
      L.push('', '🔄 *FUNIL* (leads que entraram em cada etapa)');
      L.push(et.map((e) => `${e.etapa} ${fmt.int(e.leads)}`).join(' → '));
    }
  }
  if (o.lojas && d.porLoja?.length > 1) {
    L.push('', '🏪 *LOJAS*');
    d.porLoja.filter((l) => Number(l.atendimentos) > 0).slice(0, 8).forEach((l, i) => {
      const lv = vendas(l);
      L.push(`${i + 1}. ${l.loja}: ${fmt.int(l.atendimentos)} leads · SLA ${fmt.pct(l.taxa_sla)}` + (lv ? ` · ${fmt.int(lv)} ${lv === 1 ? 'venda' : 'vendas'}` : ''));
    });
  }
  if (o.vend && d.vendedores?.length) {
    const v = d.vendedores.filter((x) => Number(x.atendimentos) > 0).slice(0, 8);
    if (v.length) {
      L.push('', v.length === 1 ? '👤 *VENDEDOR*' : '👥 *VENDEDORES*');
      for (const x of v) {
        const xv = vendas(x);
        L.push(`${x.vendedor}` + (escopo.multi ? ` (${x.loja})` : '') + `: ${fmt.int(x.atendimentos)} leads · SLA ${fmt.pct(x.taxa_sla)} · ${fmt.min(x.tempo_medio_min)}` + (xv ? ` · ${fmt.int(xv)} ${xv === 1 ? 'venda' : 'vendas'}` : ''));
      }
    }
  }
  if (o.horas && d.horarios?.length) {
    const top = [...d.horarios].sort((a, b) => Number(b.atendimentos) - Number(a.atendimentos))[0];
    const porDia = {};
    for (const h of d.horarios) porDia[h.dia_semana] = (porDia[h.dia_semana] || 0) + Number(h.atendimentos);
    const diaTop = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0];
    L.push('', `⏰ *Pico:* ${DIAS[top.dia_semana]}, ${top.hora}h–${Number(top.hora) + 1}h` + (diaTop ? ` · dia com mais leads: ${DIAS[diaTop[0]]}` : ''));
  }
  if (o.plano) L.push(...textoPlano(diagnosticar(d, escopo, o.meta)));
  if (o.obs) L.push('', '📝 ' + o.obs);
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
  const opts = { comp: $('.o-comp', main), funil: $('.o-funil', main), vend: $('.o-vend', main), lojas: $('.o-lojas', main), horas: $('.o-horas', main), inv: $('.o-inv', main), ads: $('.o-ads', main), traf: $('.o-traf', main), plano: $('.o-plano', main), obs: $('.o-obs', main) };
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
  const argsC = { ...args, p_comparar: f.comparar || 'anterior' };
  let dados;
  try {
    const [kpis, etapas, vendedores, horarios, porLoja, inv, ads, traf] = await Promise.all([
      rpc('atend_kpis', argsC), rpc('atend_etapas', argsC), rpc('atend_vendedores', argsC), rpc('atend_horarios', args),
      multi ? rpc('atend_por_loja', { p_inicio: f.inicio, p_fim: f.fim, p_comparar: argsC.p_comparar }) : Promise.resolve([]),
      rpc('atend_investimento', argsC).catch(() => null), rpc('atend_anuncios', args).catch(() => null),
      rpc('atend_trafego', argsC).catch(() => null),
    ]);
    dados = { kpis: kpis?.[0], etapas, vendedores, horarios, porLoja, inv, ads, traf };
    if (!traf?.atual || !Number(traf.atual.leads_total)) opts.traf.closest('label').hidden = true;
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
    texto.value = montarTexto(dados, { comp: opts.comp.checked, funil: opts.funil.checked, vend: opts.vend.checked, lojas: opts.lojas.checked, horas: opts.horas.checked, inv: opts.inv.checked, ads: opts.ads.checked, traf: opts.traf.checked, plano: opts.plano.checked, meta: metaPara(ctx.metas, f.conta), obs: opts.obs.value.trim() }, escopo);
    texto.disabled = false; editado = false;
    texto.addEventListener('input', () => { editado = true; }, { once: true });
    atualizarSaida();
  };
  const aoMudarOpcao = () => {
    if (editado) { toast('Você editou o texto. Use “Gerar de novo” para aplicar as opções (suas edições serão substituídas).'); return; }
    gerar(true);
  };
  for (const k of ['comp', 'funil', 'vend', 'lojas', 'horas', 'inv', 'ads', 'traf', 'plano']) opts[k].addEventListener('change', aoMudarOpcao);
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

  const infoG = $('.slot-grupos', main), btnG = $('.act-grupos', main);
  const quando = (iso) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const carregarGrupos = async (manter) => {
    const antes = manter ? sel.value : '';
    try {
      destinos = await rpc('atend_admin_destinos');
      const grupos = destinos?.grupos || [];
      if (!grupos.length) {
        sel.replaceChildren(el('option', { value: '', text: 'Nenhum grupo de CRM encontrado ainda' })); btn.disabled = true;
      } else {
        btn.disabled = false;
        sel.replaceChildren(el('option', { value: '', text: 'Escolha o grupo de CRM…' }),
          ...grupos.map((g) => el('option', { value: g.jid, text: String(g.nome).replace(/^[^A-Za-z0-9À-ú]+/, '').trim() })));
        const daLoja = grupos.filter((g) => ctx.filtros.conta && (g.lojas || []).map(Number).includes(Number(ctx.filtros.conta)));
        if (antes && grupos.some((g) => g.jid === antes)) sel.value = antes;
        else if (daLoja.length === 1) sel.value = daLoja[0].jid;
      }
      infoG.textContent = grupos.length + ' grupos de CRM' + (destinos?.atualizado_em ? ' · lista atualizada em ' + quando(destinos.atualizado_em) : '');
      return grupos;
    } catch (e) { sel.replaceChildren(el('option', { value: '', text: 'Não foi possível carregar os grupos' })); btn.disabled = true; return []; }
  };
  await carregarGrupos();

  btnG.addEventListener('click', async () => {
    const antes = new Set((destinos?.grupos || []).map((g) => g.jid));
    btnG.disabled = true; btnG.textContent = 'Buscando no WhatsApp…';
    try {
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error('Faça login de novo.');
      // text/plain evita a checagem prévia de CORS; o fluxo lê o token do corpo e confere se é ADM
      const r = await fetch(N8N_GRUPOS, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || 'O WhatsApp não respondeu. Tente de novo em alguns minutos.');
      const grupos = await carregarGrupos(true);
      const novos = grupos.filter((g) => !antes.has(g.jid)).map((g) => String(g.nome).replace(/^[^A-Za-z0-9À-ú]+/, '').trim());
      toast(novos.length ? `Grupos atualizados. Novos: ${novos.join(', ')}` : `Grupos atualizados (${grupos.length} de CRM, nenhum novo).`);
    } catch (e) { toast('Não foi possível atualizar os grupos: ' + e.message, true); }
    btnG.disabled = false; btnG.textContent = 'Atualizar grupos';
  });

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
