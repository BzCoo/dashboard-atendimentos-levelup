import { fmt, isNum } from './core.js?v=202611041631';

/* Plano de ação do relatório: regras sobre os números do período.
   Cada regra devolve { peso, titulo, fato, acoes[] }; ficam as mais graves (até 5). */

const DIA = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const DIA_PL = ['', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados', 'domingos'];
const n = (v) => Number(v) || 0;
const vendasDe = (x) => Math.max(n(x.vendas), n(x.vendas_etapa));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const lista = (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' e ' + xs[xs.length - 1]);

export const PADRAO = { meta_sla: 80, meta_resposta: 90, meta_tempo_min: null, meta_custo_atend: null };

export const diagnosticar = (d, escopo, metaLoja) => {
  const k = d.kpis || {};
  const meta = { ...PADRAO, ...Object.fromEntries(Object.entries(metaLoja || {}).filter(([, v]) => isNum(v))) };
  const sla = n(k.sla_min) || 10;
  const total = n(k.atendimentos);
  const out = [];
  if (!total) {
    if (n(k.atendimentos_ant) >= 10) out.push({ peso: 90, titulo: 'Nenhum lead novo no período', fato: `No período anterior foram ${fmt.int(k.atendimentos_ant)}.`, acoes: ['Conferir se as campanhas estão ativas e se o WhatsApp da loja continua conectado ao CRM', 'Ver se os leads estão caindo em outra subconta ou em outro número'] });
    return out;
  }

  // Vendedores com volume relevante
  const vend = (d.vendedores || []).filter((x) => n(x.atendimentos) > 0);
  const relev = vend.filter((x) => n(x.atendimentos) >= Math.max(5, total * 0.08));

  // 1. Tempo de resposta (SLA)
  if (isNum(k.taxa_sla) && k.taxa_sla < meta.meta_sla) {
    const piores = relev.filter((x) => isNum(x.taxa_sla) && x.taxa_sla < meta.meta_sla - 10).sort((a, b) => a.taxa_sla - b.taxa_sla).slice(0, 3);
    const acoes = [];
    if (piores.length && relev.length > 1) acoes.push(`Acompanhar de perto ${lista(piores.map((x) => `${x.vendedor} (${fmt.pct(x.taxa_sla)} no SLA)`))}`);
    else if (piores.length === 1) acoes.push(`${piores[0].vendedor} concentra os atendimentos: deixar o alerta de lead novo ligado no celular e responder primeiro, qualificar depois`);
    acoes.push('Ativar a notificação de lead novo no app do CRM para todos os vendedores');
    acoes.push(`Usar uma mensagem de boas-vindas pronta para responder em menos de ${sla} min e ganhar tempo para a conversa`);
    if (relev.length > 1 && piores.length) acoes.push('Quem estiver livre assume o lead que passar do SLA sem resposta (rodízio)');
    out.push({ peso: 60 + (meta.meta_sla - k.taxa_sla), titulo: 'Tempo de resposta abaixo da meta', fato: `${fmt.pct(k.taxa_sla)} dos leads foram respondidos em até ${sla} min (meta ${fmt.pct(meta.meta_sla)}); primeira resposta média de ${fmt.min(k.tempo_medio_min)}.`, acoes });
  } else if (isNum(k.var_taxa_sla) && k.var_taxa_sla <= -10) {
    out.push({ peso: 45 - k.var_taxa_sla, titulo: 'Tempo de resposta piorou', fato: `O SLA caiu ${fmt.sinal(k.var_taxa_sla, 'pp')} em relação ao período anterior (agora ${fmt.pct(k.taxa_sla)}).`, acoes: ['Conversar com a equipe sobre o que mudou (folgas, escala, volume maior)', 'Reforçar o alerta de lead novo no celular'] });
  }

  // 2. Leads sem resposta nenhuma
  const semResp = n(k.sem_resposta), pSem = 100 * semResp / total;
  if (semResp >= 3 && pSem >= 10) {
    out.push({ peso: 50 + pSem, titulo: 'Leads sem nenhuma resposta', fato: `${fmt.int(semResp)} leads (${fmt.pct(pSem)}) não receberam resposta no período.`, acoes: ['Hoje: chamar de volta todos eles (no painel, lista de leads → "Só sem resposta")', 'Criar um follow-up automático para lead que ficar 1 hora sem resposta', 'Fechar o dia com zero leads sem resposta'] });
  }

  // 3. Dias e horários sem cobertura
  const porDia = {};
  for (const h of d.horarios || []) {
    const x = (porDia[h.dia_semana] ||= { a: 0, r: 0 });
    x.a += n(h.atendimentos); x.r += n(h.respondidos);
  }
  const temResp = (d.horarios || []).some((h) => h.respondidos !== undefined && h.respondidos !== null);
  const fracos = Object.entries(porDia).filter(([, x]) => x.a >= 4 && x.r / x.a < 0.5).sort((a, b) => b[1].a - a[1].a);
  const bons = Object.values(porDia).filter((x) => x.a >= 4 && x.r / x.a >= 0.7).length;
  // Só aponta dias quando há contraste: se todos vão mal, o problema é geral (regras 1 e 2)
  if (temResp && fracos.length && bons) {
    const qtd = fracos.reduce((s, [, x]) => s + x.a - x.r, 0);
    const fimSemana = fracos.every(([dia]) => Number(dia) >= 6);
    out.push({ peso: 40 + qtd, titulo: fimSemana ? 'Fim de semana sem atendimento' : 'Dias com pouca resposta',
      fato: cap(`${lista(fracos.map(([dia, x]) => `${DIA_PL[dia]}: ${fmt.int(x.r)} de ${fmt.int(x.a)} leads respondidos`))}.`),
      acoes: [fimSemana ? 'Definir um plantão no WhatsApp aos ' + lista(fracos.map(([dia]) => DIA_PL[dia])) + ', nem que seja por algumas horas' : 'Revisar a escala nesses dias e deixar alguém responsável pelos leads novos',
        'Ligar uma resposta automática fora do expediente: avisa quando vai retornar e já pergunta o carro/moto de interesse',
        `Na abertura do dia seguinte, responder primeiro quem chegou ${fimSemana ? 'no fim de semana' : 'nesses dias'}`] });
  }

  // 4. Funil parado
  const et = (d.etapas || []).filter((e) => !e.venda).sort((a, b) => n(a.posicao) - n(b.posicao));
  if (et.length >= 3) {
    const depois = et.filter((e) => n(e.posicao) >= 2);
    const agora = depois.reduce((s, e) => s + n(e.leads), 0), antes = depois.reduce((s, e) => s + n(e.leads_ant), 0);
    const parada = depois.filter((e) => !n(e.leads) && n(e.leads_ant) >= 5).sort((a, b) => n(b.leads_ant) - n(a.leads_ant))[0];
    if (!agora && antes >= 5) {
      out.push({ peso: 75, titulo: 'Funil parou depois do atendimento', fato: `Nenhum lead passou da etapa ${et[1].etapa} no período${parada ? ` (antes, ${fmt.int(parada.leads_ant)} chegaram em ${parada.etapa})` : ''}.`, acoes: ['Conferir se os vendedores (ou a automação) estão movendo os cards no CRM', 'Separar 15 min por dia para atualizar as etapas das conversas em andamento'] });
    } else if (total >= 30 && agora / total < 0.1) {
      out.push({ peso: 35, titulo: 'Poucos leads avançam no funil', fato: agora ? `Só ${fmt.int(agora)} de ${fmt.int(total)} leads chegaram em etapas depois de ${et[1].etapa}.` : `Nenhum dos ${fmt.int(total)} leads chegou em etapas depois de ${et[1].etapa}.`, acoes: ['Usar um roteiro de qualificação: modelo, entrada, forma de pagamento e quando pretende comprar', 'Fazer follow-up em 24 h e em 72 h com quem parou de responder', 'Puxar para simulação ou visita já na primeira conversa'] });
    }
  }

  // 5. Vendas não registradas
  const vt = vendasDe(k), vta = Math.max(n(k.vendas_ant), n(k.vendas_etapa_ant));
  if (!vt && total >= 30) {
    out.push({ peso: vta ? 55 : 30, titulo: vta ? 'Nenhuma venda no período' : 'Vendas não aparecem no CRM', fato: vta ? `No período anterior foram ${fmt.int(vta)}.` : `${fmt.int(total)} leads e nenhuma venda marcada.`, acoes: vta ? ['Confirmar com a equipe se houve vendas que não foram marcadas no CRM', 'Revisar as negociações em andamento e retomar quem pediu simulação ou visita'] : ['Combinar com a equipe: toda venda vai para a etapa de venda (ou marcada como ganha) no mesmo dia', 'Sem isso não dá para medir conversão nem custo por venda'] });
  }

  // 6. Volume caiu
  if (isNum(k.var_atendimentos) && k.var_atendimentos <= -25 && n(k.atendimentos_ant) >= 20) {
    const inv = d.inv?.total;
    const acoes = isNum(inv?.var_investimento) && inv.var_investimento <= -15
      ? [`O investimento também caiu (${fmt.sinal(inv.var_investimento, 'pct')}): avaliar se vale voltar ao orçamento anterior`]
      : ['Conferir se alguma campanha foi pausada ou reprovada no Meta', 'Testar criativos novos com os carros/motos de maior procura'];
    out.push({ peso: 30 - k.var_atendimentos / 2, titulo: 'Menos leads que no período anterior', fato: `${fmt.int(total)} leads contra ${fmt.int(k.atendimentos_ant)} (${fmt.sinal(k.var_atendimentos, 'pct')}).`, acoes });
  }

  // 7. Custo por atendimento subiu
  const t = d.inv?.total;
  if (t && isNum(t.custo_atend) && isNum(t.custo_atend_ant) && t.custo_atend_ant > 0) {
    const varC = 100 * (t.custo_atend - t.custo_atend_ant) / t.custo_atend_ant;
    const acimaMeta = isNum(meta.meta_custo_atend) && t.custo_atend > meta.meta_custo_atend;
    if (varC >= 20 || acimaMeta) out.push({ peso: 25 + Math.min(varC, 40), titulo: 'Custo por atendimento subiu', fato: `${fmt.brl(t.custo_atend)} por atendimento, antes ${fmt.brl(t.custo_atend_ant)}` + (acimaMeta ? ` (meta ${fmt.brl(meta.meta_custo_atend)})` : '') + '.', acoes: ['Pausar os anúncios com custo por conversa mais alto e reforçar os que trazem lead mais barato', 'Renovar os criativos que estão rodando há mais tempo'] });
  }
  if (t && n(t.empresas_sem_dados)) out.push({ peso: 20, titulo: 'Investimento do Meta não chegou', fato: `Sem dados de anúncio para ${lista(t.nomes_sem_dados || [])}.`, acoes: ['Conferir a conexão da conta de anúncios com o painel'] });

  // 8. Distribuição entre vendedores
  if (relev.length >= 2) {
    const top = [...relev].sort((a, b) => n(b.atendimentos) - n(a.atendimentos))[0];
    const share = 100 * n(top.atendimentos) / total;
    if (share >= 70 && isNum(top.taxa_sla) && top.taxa_sla < meta.meta_sla) out.push({ peso: 35, titulo: 'Leads concentrados em um vendedor', fato: `${top.vendedor} recebeu ${fmt.pct(share)} dos leads e respondeu ${fmt.pct(top.taxa_sla)} no SLA.`, acoes: ['Distribuir os leads em rodízio entre os vendedores', 'Ou definir um segundo responsável para os horários de pico'] });
  }
  const baixos = vend.length < 2 ? [] : vend.filter((x) => n(x.atendimentos) >= 8 && isNum(x.taxa_resposta) && x.taxa_resposta < 60);
  if (baixos.length) out.push({ peso: 38, titulo: 'Vendedores deixando leads sem resposta', fato: `${lista(baixos.slice(0, 3).map((x) => `${x.vendedor} respondeu ${fmt.pct(x.taxa_resposta)}`))}.`, acoes: ['Revisar com eles a lista de leads sem resposta e retomar ainda hoje', 'Checar se o WhatsApp deles está conectado e recebendo as conversas'] });

  // 9. Anúncios: veículo que traz lead e não avança
  const vs = (d.ads?.veiculos || []).filter((v) => n(v.leads) >= 10);
  const ruins = vs.filter((v) => !n(v.avancaram) && !n(v.vendas));
  const bom = [...vs].filter((v) => n(v.avancaram) > 0).sort((a, b) => n(b.avancaram) / n(b.leads) - n(a.avancaram) / n(a.leads))[0];
  if (ruins.length) out.push({ peso: 22, titulo: 'Anúncios que trazem lead, mas não avançam', fato: `${lista(ruins.slice(0, 3).map((v) => `${v.veiculo} (${fmt.int(v.leads)} leads)`))}: nenhum avançou no funil.`, acoes: ['Conferir se o carro/moto ainda está disponível e se o preço do anúncio bate com a loja'].concat(bom ? [`Levar parte da verba para ${bom.veiculo}, que tem a melhor taxa de avanço`] : []) });

  // 10. Mais de uma loja: onde agir primeiro
  if (escopo.multi && (d.porLoja || []).length > 1) {
    const criticas = d.porLoja.filter((l) => n(l.atendimentos) >= 15 && isNum(l.taxa_sla) && l.taxa_sla < meta.meta_sla - 15).sort((a, b) => a.taxa_sla - b.taxa_sla).slice(0, 3);
    if (criticas.length) out.push({ peso: 58, titulo: 'Lojas que precisam de atenção primeiro', fato: lista(criticas.map((l) => `${l.loja} (${fmt.pct(l.taxa_sla)} no SLA, ${fmt.int(l.atendimentos)} leads)`)) + '.', acoes: ['Gerar o relatório de cada uma delas para ver o plano detalhado', 'Alinhar com o responsável da loja uma meta de SLA para a próxima semana'] });
  }

  return out.sort((a, b) => b.peso - a.peso).slice(0, 5);
};

/* Texto no formato do WhatsApp */
export const textoPlano = (planos) => {
  const L = ['', '🎯 *PLANO DE AÇÃO*'];
  if (!planos.length) { L.push('Indicadores dentro do esperado no período. Manter a rotina e acompanhar na próxima semana.'); return L; }
  planos.forEach((p, i) => {
    L.push(`*${i + 1}. ${p.titulo}*`, p.fato);
    for (const a of p.acoes) L.push('➜ ' + a);
    if (i < planos.length - 1) L.push('');
  });
  return L;
};
