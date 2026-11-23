/* Texto do relatório (puro, sem navegador): o site usa ao montar o relatório e a função
   relatorio-auto do Supabase usa no envio agendado. Mesma regra nos dois lugares. */
import { fmt, isNum } from './fmt.js?v=202611231234';
import { diagnosticar, textoPlano } from './plano.js?v=202611231234';

export const etapasVisiveis = (rows, max) => {
  const com = (rows || []).filter((d) => Number(d.leads) > 0 || Number(d.leads_ant) > 0);
  if (com.length <= max) return com;
  const vol = (d) => Math.max(Number(d.leads) || 0, Number(d.leads_ant) || 0);
  const fica = new Set([...com].sort((a, b) => vol(b) - vol(a)).slice(0, max));
  com.filter((d) => d.venda).forEach((d) => fica.add(d));
  return com.filter((d) => fica.has(d));
};

const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/* Monta o texto no formato do relatório semanal do WhatsApp (enxuto: uma linha por assunto) */
export const montarTexto = (d, o, escopo) => {
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

