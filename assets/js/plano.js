import { fmt, isNum } from './core.js?v=202611131457';

/* Plano de ação do relatório: regras sobre os números do período.
   Cada regra devolve { peso, titulo, acoes[], meta }: o título já traz o número do problema,
   as ações dizem quando/quem/o quê e a meta é um número para conferir na semana seguinte.
   Ficam as 3 mais graves. */

const DIA = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const DIA_PL = ['', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados', 'domingos'];
const n = (v) => Number(v) || 0;
const vendasDe = (x) => Math.max(n(x.vendas), n(x.vendas_etapa));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const proxMeta = (atual, alvo, passo = 10) => Math.min(alvo, Math.ceil((atual + passo) / 5) * 5);
const lista = (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' e ' + xs[xs.length - 1]);

export const PADRAO = { meta_sla: 80, meta_resposta: 90, meta_tempo_min: null, meta_custo_atend: null };

export const diagnosticar = (d, escopo, metaLoja) => {
  const k = d.kpis || {};
  const meta = { ...PADRAO, ...Object.fromEntries(Object.entries(metaLoja || {}).filter(([, v]) => isNum(v))) };
  const sla = n(k.sla_min) || 10;
  const total = n(k.atendimentos);
  const out = [];
  if (!total) {
    if (n(k.atendimentos_ant) >= 10) out.push({ peso: 90, titulo: `Nenhum lead novo (antes ${fmt.int(k.atendimentos_ant)})`, acoes: ['Hoje: conferir se as campanhas estão ativas no Meta e se o WhatsApp da loja segue conectado ao CRM'], meta: 'voltar a receber leads em até 24 h' });
    return out;
  }

  const vend = (d.vendedores || []).filter((x) => n(x.atendimentos) > 0);
  const relev = vend.filter((x) => n(x.atendimentos) >= Math.max(5, total * 0.08));

  // 1. Tempo de resposta (SLA)
  if (isNum(k.taxa_sla) && k.taxa_sla < meta.meta_sla) {
    const piores = relev.filter((x) => isNum(x.taxa_sla) && x.taxa_sla < meta.meta_sla - 10).sort((a, b) => a.taxa_sla - b.taxa_sla).slice(0, 2);
    const acoes = ['Hoje: ligar a notificação de lead novo no app do CRM de ' + (relev.length && relev.length <= 4 && !escopo.multi ? lista(relev.map((x) => x.vendedor)) : 'todos os vendedores') + ` e responder com uma mensagem pronta em até ${sla} min`];
    if (piores.length && relev.length > 1) acoes.push(`Esta semana: ${lista(piores.map((x) => `${x.vendedor} (${fmt.pct(x.taxa_sla)})`))} passa${piores.length > 1 ? 'm' : ''} o lead para outro vendedor quando não puder responder em ${sla} min`);
    out.push({ peso: 60 + (meta.meta_sla - k.taxa_sla), titulo: `Só ${fmt.pct(k.taxa_sla)} respondidos em até ${sla} min (meta ${fmt.pct(meta.meta_sla)})`, acoes, meta: `${fmt.pct(proxMeta(k.taxa_sla, meta.meta_sla))} no SLA` });
  } else if (isNum(k.var_taxa_sla) && k.var_taxa_sla <= -10) {
    out.push({ peso: 45 - k.var_taxa_sla, titulo: `SLA caiu ${fmt.sinal(k.var_taxa_sla, 'pp')} (agora ${fmt.pct(k.taxa_sla)})`, acoes: ['Esta semana: revisar a escala (folgas, horário de pico) e deixar um responsável por lead novo em cada turno'], meta: `voltar a ${fmt.pct(n(k.taxa_sla_ant))} no SLA` });
  }

  // 2. Leads sem resposta nenhuma
  const semResp = n(k.sem_resposta), pSem = 100 * semResp / total;
  if (semResp >= 3 && pSem >= 10) {
    out.push({ peso: 50 + pSem, titulo: `${fmt.int(semResp)} leads sem nenhuma resposta (${fmt.pct(pSem)})`, acoes: [`Hoje: chamar os ${fmt.int(semResp)} de volta (painel → lista de leads → "Só sem resposta")`, 'Todo dia, antes de fechar: conferir a lista e não deixar ninguém sem resposta'], meta: 'menos de 5% sem resposta' });
  }

  // 3. Dias sem cobertura
  const porDia = {};
  for (const h of d.horarios || []) {
    const x = (porDia[h.dia_semana] ||= { a: 0, r: 0 });
    x.a += n(h.atendimentos); x.r += n(h.respondidos);
  }
  const temResp = (d.horarios || []).some((h) => h.respondidos !== undefined && h.respondidos !== null);
  const fracos = Object.entries(porDia).filter(([, x]) => x.a >= 4 && x.r / x.a < 0.5).sort((a, b) => b[1].a - a[1].a);
  const bons = Object.values(porDia).filter((x) => x.a >= 4 && x.r / x.a >= 0.7).length;
  if (temResp && fracos.length && bons) {
    const qtd = fracos.reduce((s, [, x]) => s + x.a - x.r, 0);
    const dias = lista(fracos.map(([dia]) => DIA_PL[dia]));
    out.push({ peso: 40 + qtd, titulo: `${fmt.int(qtd)} leads sem resposta aos ${dias}`,
      acoes: [`Esta semana: definir quem cobre os ${dias} (plantão de algumas horas já resolve)`, 'Ligar resposta automática fora do expediente avisando o horário de retorno'],
      meta: `responder pelo menos 70% aos ${dias}` });
  }

  // 4. Funil parado
  const et = (d.etapas || []).filter((e) => !e.venda).sort((a, b) => n(a.posicao) - n(b.posicao));
  if (et.length >= 3) {
    const depois = et.filter((e) => n(e.posicao) >= 2);
    const agora = depois.reduce((s, e) => s + n(e.leads), 0), antes = depois.reduce((s, e) => s + n(e.leads_ant), 0);
    if (!agora && antes >= 5) {
      out.push({ peso: 75, titulo: `Nenhum lead passou de ${et[1].etapa} (antes ${fmt.int(antes)})`, acoes: ['Hoje: conferir se os vendedores (ou a automação) estão movendo os cards no CRM', 'Todo dia: 15 min no fim do expediente para atualizar as etapas'], meta: 'cards voltando a andar no funil' });
    } else if (total >= 30 && agora / total < 0.1) {
      out.push({ peso: 35, titulo: `Só ${fmt.int(agora)} de ${fmt.int(total)} leads avançaram depois de ${et[1].etapa}`, acoes: ['Na 1ª conversa: perguntar modelo, entrada, forma de pagamento e prazo de compra, e já oferecer simulação ou visita', 'Follow-up em 24 h e 72 h com quem parou de responder'], meta: `${fmt.int(Math.max(Math.ceil(total * 0.1), agora + 5))} leads avançando` });
    }
  }

  // 5. Vendas não registradas
  const vt = vendasDe(k), vta = Math.max(n(k.vendas_ant), n(k.vendas_etapa_ant));
  if (!vt && total >= 30) {
    out.push(vta
      ? { peso: 55, titulo: `Nenhuma venda marcada (antes ${fmt.int(vta)})`, acoes: ['Hoje: confirmar com a equipe se houve vendas não marcadas no CRM', 'Esta semana: retomar quem pediu simulação ou visita'], meta: 'toda venda marcada no CRM no mesmo dia' }
      : { peso: 30, titulo: `${fmt.int(total)} leads e nenhuma venda no CRM`, acoes: ['A partir de hoje: toda venda vai para a etapa de venda (ou marcada como ganha) no mesmo dia'], meta: 'vendas aparecendo no relatório' });
  }

  // 6. Volume caiu
  if (isNum(k.var_atendimentos) && k.var_atendimentos <= -25 && n(k.atendimentos_ant) >= 20) {
    const inv = d.inv?.total;
    const acoes = isNum(inv?.var_investimento) && inv.var_investimento <= -15
      ? [`Esta semana: o investimento caiu ${fmt.sinal(inv.var_investimento, 'pct')}; decidir se volta ao orçamento anterior`]
      : ['Hoje: conferir no Meta se alguma campanha foi pausada ou reprovada', 'Esta semana: subir criativos novos com os veículos mais procurados'];
    out.push({ peso: 30 - k.var_atendimentos / 2, titulo: `Leads caíram ${fmt.sinal(k.var_atendimentos, 'pct')} (${fmt.int(total)} contra ${fmt.int(k.atendimentos_ant)})`, acoes, meta: `voltar a ${fmt.int(k.atendimentos_ant)} leads` });
  }

  // 7. Custo por atendimento
  const t = d.inv?.total;
  if (t && isNum(t.custo_atend) && isNum(t.custo_atend_ant) && t.custo_atend_ant > 0) {
    const varC = 100 * (t.custo_atend - t.custo_atend_ant) / t.custo_atend_ant;
    const acimaMeta = isNum(meta.meta_custo_atend) && t.custo_atend > meta.meta_custo_atend;
    if (varC >= 20 || acimaMeta) out.push({ peso: 25 + Math.min(varC, 40), titulo: `Custo por atendimento subiu para ${fmt.brl(t.custo_atend)} (antes ${fmt.brl(t.custo_atend_ant)})`, acoes: ['Esta semana: pausar os anúncios com conversa mais cara e reforçar os mais baratos'], meta: `até ${fmt.brl(acimaMeta ? meta.meta_custo_atend : t.custo_atend_ant)} por atendimento` });
  }
  if (t && n(t.empresas_sem_dados)) out.push({ peso: 20, titulo: `Sem dados do Meta: ${lista(t.nomes_sem_dados || [])}`, acoes: ['Conferir a conexão da conta de anúncios com o painel'], meta: null });

  // 8. Vendedores
  if (relev.length >= 2) {
    const top = [...relev].sort((a, b) => n(b.atendimentos) - n(a.atendimentos))[0];
    const share = 100 * n(top.atendimentos) / total;
    if (share >= 70 && isNum(top.taxa_sla) && top.taxa_sla < meta.meta_sla) out.push({ peso: 35, titulo: `${top.vendedor} recebe ${fmt.pct(share)} dos leads e responde ${fmt.pct(top.taxa_sla)} no SLA`, acoes: ['Esta semana: distribuir os leads em rodízio ou ter um segundo responsável no horário de pico'], meta: `nenhum vendedor com mais de 60% dos leads` });
  }
  const baixos = vend.length < 2 ? [] : vend.filter((x) => n(x.atendimentos) >= 8 && isNum(x.taxa_resposta) && x.taxa_resposta < 60);
  if (baixos.length) out.push({ peso: 38, titulo: `${lista(baixos.slice(0, 3).map((x) => `${x.vendedor} respondeu só ${fmt.pct(x.taxa_resposta)}`))}`, acoes: [`Hoje: ${lista(baixos.slice(0, 3).map((x) => x.vendedor))} retoma${baixos.length > 1 ? 'm' : ''} os leads sem resposta e confere se o WhatsApp está conectado`], meta: 'todos acima de 80% de resposta' });

  // 9. Anúncios que não avançam
  const vs = (d.ads?.veiculos || []).filter((v) => n(v.leads) >= 10);
  const ruins = vs.filter((v) => !n(v.avancaram) && !n(v.vendas));
  const bom = [...vs].filter((v) => n(v.avancaram) > 0).sort((a, b) => n(b.avancaram) / n(b.leads) - n(a.avancaram) / n(a.leads))[0];
  if (ruins.length) out.push({ peso: 22, titulo: `${lista(ruins.slice(0, 2).map((v) => `${v.veiculo} (${fmt.int(v.leads)} leads)`))} sem nenhum avanço`, acoes: ['Hoje: conferir se o veículo ainda está disponível e se o preço do anúncio bate com a loja'].concat(bom ? [`Passar parte da verba para ${bom.veiculo}, que mais avança no funil`] : []), meta: null });

  // 10. Várias lojas: onde agir primeiro
  if (escopo.multi && (d.porLoja || []).length > 1) {
    const criticas = d.porLoja.filter((l) => n(l.atendimentos) >= 15 && isNum(l.taxa_sla) && l.taxa_sla < meta.meta_sla - 15).sort((a, b) => a.taxa_sla - b.taxa_sla).slice(0, 3);
    if (criticas.length) out.push({ peso: 58, titulo: 'Lojas com pior SLA: ' + lista(criticas.map((l) => `${l.loja} (${fmt.pct(l.taxa_sla)})`)), acoes: ['Esta semana: gerar o relatório de cada loja e combinar a meta com o responsável da loja'], meta: `todas acima de ${fmt.pct(meta.meta_sla - 15)} no SLA` });
  }

  return out.sort((a, b) => b.peso - a.peso).slice(0, 3);
};

/* Texto no formato do WhatsApp */
export const textoPlano = (planos) => {
  const L = ['', '🎯 *PLANO DE AÇÃO*'];
  if (!planos.length) { L.push('Indicadores dentro da meta. Manter a rotina.'); return L; }
  planos.forEach((p, i) => {
    L.push(`*${i + 1}. ${p.titulo}*`);
    for (const a of p.acoes) L.push('➜ ' + a);
    if (p.meta) L.push(`✅ Meta para a próxima semana: ${p.meta}`);
    if (i < planos.length - 1) L.push('');
  });
  return L;
};
