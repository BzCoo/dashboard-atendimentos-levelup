import { $, el, clone, rpc, fmt, isNum, toast, copiar } from './core.js?v=202610271521';
import { montarFiltros } from './filtros.js?v=202610271521';

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
  L.push(`Vendas marcadas: ${fmt.int(k.vendas)}` + comp(k.var_vendas, 'abs'));

  if (o.funil && d.etapas?.length) {
    const et = d.etapas.filter((e) => Number(e.leads) > 0).slice(0, 10);
    if (et.length) {
      L.push('', '🔄 *MOVIMENTO NO FUNIL*', 'Leads que entraram em cada etapa no período');
      for (const e of et) L.push(`• ${e.etapa}: ${fmt.int(e.leads)}` + (o.comp ? ` (antes ${fmt.int(e.leads_ant)})` : ''));
    }
  }
  if (o.lojas && d.porLoja?.length > 1) {
    L.push('', '🏪 *LOJAS*');
    d.porLoja.filter((l) => Number(l.atendimentos) > 0).slice(0, 15).forEach((l, i) => {
      L.push(`${i + 1}. *${l.loja}* — ${fmt.int(l.atendimentos)} atendimentos | SLA ${fmt.pct(l.taxa_sla)} | 1ª resp. ${fmt.min(l.tempo_medio_min)}` + (Number(l.vendas) ? ` | ${fmt.int(l.vendas)} vendas` : ''));
    });
  }
  if (o.vend && d.vendedores?.length) {
    const v = d.vendedores.filter((x) => Number(x.atendimentos) > 0).slice(0, escopo.multi ? 15 : 30);
    if (v.length) {
      L.push('', d.vendedores.length === 1 ? '👤 *VENDEDOR*' : '👥 *VENDEDORES*');
      for (const x of v) {
        L.push(`*${x.vendedor}*` + (escopo.multi ? ` (${x.loja})` : '') + ` — ${fmt.int(x.atendimentos)} atendimentos` + (o.comp && isNum(x.var_atendimentos) ? ` (${fmt.sinal(x.var_atendimentos, 'pct')})` : ''));
        L.push(`Resposta ${fmt.pct(x.taxa_resposta)} | SLA ${fmt.pct(x.taxa_sla)} | 1ª resposta ${fmt.min(x.tempo_medio_min)}` + (Number(x.vendas) ? ` | ${fmt.int(x.vendas)} vendas` : ''));
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
  const opts = { comp: $('.o-comp', main), funil: $('.o-funil', main), vend: $('.o-vend', main), lojas: $('.o-lojas', main), horas: $('.o-horas', main), obs: $('.o-obs', main) };
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
    const [kpis, etapas, vendedores, horarios, porLoja] = await Promise.all([
      rpc('atend_kpis', args), rpc('atend_etapas', args), rpc('atend_vendedores', args), rpc('atend_horarios', args),
      multi ? rpc('atend_por_loja', { p_inicio: f.inicio, p_fim: f.fim }) : Promise.resolve([]),
    ]);
    dados = { kpis: kpis?.[0], etapas, vendedores, horarios, porLoja };
    if (!dados.kpis) throw new Error('Sem dados para o período.');
  } catch (e) {
    texto.value = 'Não foi possível montar o relatório: ' + e.message; texto.disabled = false; atualizarSaida();
    toast(e.message, true); return;
  }

  let editado = false;
  texto.addEventListener('input', () => { editado = true; }, { once: true });
  const gerar = (forcar) => {
    if (editado && !forcar) return;
    texto.value = montarTexto(dados, { comp: opts.comp.checked, funil: opts.funil.checked, vend: opts.vend.checked, lojas: opts.lojas.checked, horas: opts.horas.checked, obs: opts.obs.value.trim() }, escopo);
    texto.disabled = false; editado = false;
    texto.addEventListener('input', () => { editado = true; }, { once: true });
    atualizarSaida();
  };
  const aoMudarOpcao = () => {
    if (editado) { toast('Você editou o texto. Use “Gerar de novo” para aplicar as opções (suas edições serão substituídas).'); return; }
    gerar(true);
  };
  for (const k of ['comp', 'funil', 'vend', 'lojas', 'horas']) opts[k].addEventListener('change', aoMudarOpcao);
  opts.obs.addEventListener('input', aoMudarOpcao);
  $('.act-gerar', main).addEventListener('click', () => gerar(true));
  $('.act-copiar', main).addEventListener('click', () => copiar(texto.value));
  $('.act-baixar', main).addEventListener('click', () => {
    const a = el('a', { href: URL.createObjectURL(new Blob([texto.value], { type: 'text/plain;charset=utf-8' })), download: `relatorio-${String(nomeLoja).toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${f.inicio}-a-${f.fim}.txt` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  gerar(true);
};
