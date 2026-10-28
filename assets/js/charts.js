import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import { ACC, PREV, GRID, DEEP, MUTED, fmt, nf0, isNum } from './core.js?v=202610281446';

export { d3 };

/* ---------- Tooltip ---------- */
const tipOf = (box) => {
  let t = box.querySelector(':scope > .lu-tip');
  if (!t) { t = document.createElement('div'); t.className = 'lu-tip'; t.setAttribute('role', 'tooltip'); box.append(t); }
  return t;
};
const showTip = (box, tip, event, title, lines) => {
  tip.replaceChildren();
  const h = document.createElement('div'); h.className = 't'; h.textContent = title; tip.append(h);
  for (const [color, label, value] of lines) {
    const r = document.createElement('div'); r.className = 'r';
    const l = document.createElement('span');
    if (color) { const i = document.createElement('i'); i.style.background = color; l.append(i); }
    l.append(document.createTextNode(label));
    const b = document.createElement('b'); b.textContent = value;
    r.append(l, b); tip.append(r);
  }
  tip.style.display = 'block';
  const bx = box.getBoundingClientRect();
  const x = event.clientX - bx.left, y = event.clientY - bx.top;
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  let left = x + 14; if (left + w > bx.width) left = Math.max(0, x - w - 14);
  let top = y - hgt - 12; if (top < 0) top = Math.min(y + 16, Math.max(0, bx.height - hgt));
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
};
const hideTip = (tip) => { tip.style.display = 'none'; };

const axis = (g) => g.attr('font-size', null).attr('font-family', null)
  .call((s) => s.select('.domain').remove())
  .call((s) => s.selectAll('.tick line').style('stroke', GRID))
  .call((s) => s.selectAll('.tick text').attr('fill', null));
const svgIn = (box, W, h) => d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${h}`).attr('role', 'img');
const leftFor = (svg, label) => { const p = svg.append('text').text(label); const w = Math.ceil(p.node().getComputedTextLength()); p.remove(); return w + 14; };
const gradient = (svg, id, color) => {
  const g = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
  [[0, .26], [.35, .12], [.7, .04], [1, 0]].forEach(([o, a]) => g.append('stop').attr('offset', o).style('stop-color', color).style('stop-opacity', a));
};
export const vazio = (box, texto) => { box.replaceChildren(); const f = document.createElement('div'); f.className = 'lu-empty'; f.textContent = texto; box.append(f); };
export const falha = (box, texto = 'Falha ao carregar') => { box.replaceChildren(); const f = document.createElement('div'); f.className = 'lu-fail'; f.textContent = texto; box.append(f); };

const H = 260, M = { t: 12, r: 8, b: 28 };
const prep = (serie) => {
  const atual = serie.filter((r) => r.periodo === 'atual');
  const ant = new Map(serie.filter((r) => r.periodo === 'anterior').map((r) => [Number(r.idx), r]));
  return atual.map((r) => ({ ...r, prev: ant.get(Number(r.idx)) || null }));
};
const xAxis = (svg, x, data, W, left) => {
  const maxTicks = Math.max(2, Math.floor((W - left) / 56));
  const step = Math.ceil(data.length / maxTicks);
  const ticks = data.filter((_, i) => i % step === 0).map((d) => d.dia);
  svg.append('g').attr('transform', `translate(0,${H - M.b + 6})`)
    .call(d3.axisBottom(x).tickValues(ticks).tickFormat((d) => fmt.dm(d)).tickSize(0).tickPadding(6)).call(axis);
};
const yAxis = (svg, y, W, left, f) => {
  svg.append('g').attr('transform', `translate(${left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(f).tickSize(-(W - left - M.r)).tickPadding(10)).call(axis);
};

/* Mini-gráfico do card principal */
export const spark = (box, serie) => {
  box.replaceChildren();
  const data = prep(serie);
  if (!data.length) return vazio(box, 'Sem dados no período.');
  const W = Math.max(240, box.clientWidth), h = Math.max(150, Math.min(240, box.clientHeight || 150));
  const svg = svgIn(box, W, h);
  const x = d3.scalePoint(data.map((d) => d.dia), [6, W - 6]);
  const yMax = d3.max(data, (d) => Math.max(Number(d.atendimentos), d.prev ? Number(d.prev.atendimentos) : 0)) || 1;
  const y = d3.scaleLinear([0, yMax], [h - 18, 8]);
  gradient(svg, 'g-spark', ACC);
  svg.append('path').datum(data).style('fill', 'url(#g-spark)').attr('d', d3.area((d) => x(d.dia), y(0), (d) => y(Number(d.atendimentos))));
  svg.append('path').datum(data.filter((d) => d.prev)).style('fill', 'none').style('stroke', PREV).attr('stroke-width', 1.5).attr('stroke-dasharray', '3 4')
    .attr('d', d3.line((d) => x(d.dia), (d) => y(Number(d.prev.atendimentos))));
  svg.append('path').datum(data).style('fill', 'none').style('stroke', ACC).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
    .attr('d', d3.line((d) => x(d.dia), (d) => y(Number(d.atendimentos))));
  const last = data[data.length - 1];
  svg.append('circle').attr('cx', x(last.dia)).attr('cy', y(Number(last.atendimentos))).attr('r', 4).style('fill', ACC).style('stroke', '#121412').attr('stroke-width', 2);
  svg.append('text').attr('x', 6).attr('y', h - 2).text(fmt.dm(data[0].dia));
  svg.append('text').attr('x', W - 6).attr('y', h - 2).attr('text-anchor', 'end').text(fmt.dm(last.dia));
  const tip = tipOf(box);
  const dot = svg.append('circle').attr('r', 4).style('fill', ACC).style('display', 'none');
  svg.append('rect').attr('width', W).attr('height', h).style('fill', 'transparent')
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event);
      const d = data[d3.minIndex(data, (p) => Math.abs(x(p.dia) - mx))];
      dot.style('display', null).attr('cx', x(d.dia)).attr('cy', y(Number(d.atendimentos)));
      showTip(box, tip, event, fmt.wdm(d.dia), [[ACC, 'Atendimentos', fmt.int(d.atendimentos)], [MUTED, 'Período anterior', d.prev ? fmt.int(d.prev.atendimentos) : '—']]);
    })
    .on('mouseleave', () => { dot.style('display', 'none'); hideTip(tip); });
};

/* Barras: atendimentos por dia */
export const volume = (box, serie) => {
  box.replaceChildren();
  const data = prep(serie);
  if (!data.length) return vazio(box, 'Sem dados no período.');
  const W = Math.max(280, box.clientWidth);
  const svg = svgIn(box, W, H);
  const yMax = d3.max(data, (d) => Math.max(Number(d.atendimentos), d.prev ? Number(d.prev.atendimentos) : 0)) || 1;
  const y = d3.scaleLinear([0, yMax], [H - M.b, M.t]).nice();
  const f = (v) => nf0.format(v);
  const left = leftFor(svg, f(y.ticks(4).slice(-1)[0]));
  const x = d3.scaleBand(data.map((d) => d.dia), [left, W - M.r]).paddingInner(0.28).paddingOuter(0.1);
  yAxis(svg, y, W, left, f);
  xAxis(svg, x, data, W, left);
  const gb = svg.append('defs').append('linearGradient').attr('id', 'g-bar').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
  gb.append('stop').attr('offset', 0).style('stop-color', ACC);
  gb.append('stop').attr('offset', 1).style('stop-color', DEEP);
  const bw = Math.min(30, x.bandwidth());
  const bars = svg.append('g').selectAll('rect').data(data).join('rect')
    .attr('x', (d) => x(d.dia) + (x.bandwidth() - bw) / 2).attr('width', bw)
    .attr('y', (d) => y(Number(d.atendimentos))).attr('height', (d) => Math.max(0, y(0) - y(Number(d.atendimentos))))
    .attr('rx', Math.min(6, bw / 2)).style('fill', 'url(#g-bar)').style('fill-opacity', 0.9);
  svg.append('path').datum(data.filter((d) => d.prev))
    .style('fill', 'none').style('stroke', MUTED).style('stroke-opacity', 0.6).attr('stroke-width', 1.5).attr('stroke-dasharray', '3 4').attr('stroke-linejoin', 'round')
    .attr('d', d3.line((d) => x(d.dia) + x.bandwidth() / 2, (d) => y(Number(d.prev.atendimentos))));
  const tip = tipOf(box);
  svg.append('g').selectAll('rect').data(data).join('rect')
    .attr('x', (d) => x(d.dia) - (x.step() * x.paddingInner()) / 2).attr('width', x.step()).attr('y', M.t).attr('height', H - M.t - M.b)
    .style('fill', 'transparent')
    .on('mousemove', (event, d) => {
      bars.style('fill-opacity', (b) => (b === d ? 1 : 0.45));
      showTip(box, tip, event, fmt.wdm(d.dia), [
        [ACC, 'Atendimentos', fmt.int(d.atendimentos)], [null, 'Respondidos', fmt.int(d.respondidos)],
        [MUTED, 'Anterior (' + (d.prev ? fmt.dm(d.prev.dia) : '—') + ')', d.prev ? fmt.int(d.prev.atendimentos) : '—'],
      ]);
    })
    .on('mouseleave', () => { bars.style('fill-opacity', 0.9); hideTip(tip); });
};

/* Linha: % no SLA por dia */
export const sla = (box, serie) => {
  box.replaceChildren();
  const data = prep(serie);
  if (!data.length) return vazio(box, 'Sem dados no período.');
  const W = Math.max(280, box.clientWidth);
  const svg = svgIn(box, W, H);
  const f = (v) => nf0.format(v) + '%';
  const y = d3.scaleLinear([0, 100], [H - M.b, M.t]);
  const left = leftFor(svg, f(100));
  const x = d3.scalePoint(data.map((d) => d.dia), [left + 10, W - M.r - 10]);
  yAxis(svg, y, W, left, f);
  xAxis(svg, x, data, W, left);
  gradient(svg, 'g-sla', ACC);
  const val = (r) => (r && isNum(r.taxa_sla) ? Number(r.taxa_sla) : null);
  const cur = data.map((d) => ({ dia: d.dia, v: val(d), d }));
  const line = d3.line((p) => x(p.dia), (p) => y(p.v)).defined((p) => p.v !== null);
  svg.append('path').datum(cur).style('fill', 'url(#g-sla)').attr('d', d3.area((p) => x(p.dia), y(0), (p) => y(p.v)).defined((p) => p.v !== null));
  svg.append('path').datum(data.map((d) => ({ dia: d.dia, v: val(d.prev) })))
    .style('fill', 'none').style('stroke', MUTED).style('stroke-opacity', 0.6).attr('stroke-width', 1.5).attr('stroke-dasharray', '3 4').attr('d', line);
  svg.append('path').datum(cur).style('fill', 'none').style('stroke', ACC).attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', line);
  svg.append('g').selectAll('circle').data(cur.filter((p) => p.v !== null)).join('circle')
    .attr('cx', (p) => x(p.dia)).attr('cy', (p) => y(p.v)).attr('r', data.length > 20 ? 2 : 3).style('fill', '#121412').style('stroke', ACC).attr('stroke-width', 1.5);
  const tip = tipOf(box);
  const hover = svg.append('line').style('stroke', 'rgba(255,255,255,.18)').attr('y1', M.t).attr('y2', H - M.b).style('display', 'none');
  const dot = svg.append('circle').attr('r', 4.5).style('fill', ACC).style('display', 'none');
  svg.append('rect').attr('x', left).attr('width', W - left - M.r).attr('y', M.t).attr('height', H - M.t - M.b).style('fill', 'transparent')
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event);
      const p = cur[d3.minIndex(cur, (c) => Math.abs(x(c.dia) - mx))];
      hover.style('display', null).attr('x1', x(p.dia)).attr('x2', x(p.dia));
      if (p.v !== null) dot.style('display', null).attr('cx', x(p.dia)).attr('cy', y(p.v)); else dot.style('display', 'none');
      showTip(box, tip, event, fmt.wdm(p.dia), [
        [ACC, 'No SLA', fmt.pct(p.d.taxa_sla)], [null, 'Respostas no prazo', fmt.int(p.d.dentro_sla) + ' de ' + fmt.int(p.d.respondidos)],
        [null, '1ª resposta média', fmt.min(p.d.tempo_medio_min)], [MUTED, 'Anterior', p.d.prev ? fmt.pct(p.d.prev.taxa_sla) : '—'],
      ]);
    })
    .on('mouseleave', () => { hover.style('display', 'none'); dot.style('display', 'none'); hideTip(tip); });
};

/* Barras horizontais: entradas por etapa */
/* Mantém a ordem do pipeline (vinda do banco); se houver etapas demais, fica com as de maior volume e as de venda */
export const etapasVisiveis = (rows, max) => {
  const com = (rows || []).filter((d) => Number(d.leads) > 0 || Number(d.leads_ant) > 0);
  if (com.length <= max) return com;
  const vol = (d) => Math.max(Number(d.leads) || 0, Number(d.leads_ant) || 0);
  const fica = new Set([...com].sort((a, b) => vol(b) - vol(a)).slice(0, max));
  com.filter((d) => d.venda).forEach((d) => fica.add(d));
  return com.filter((d) => fica.has(d));
};
export const etapas = (box, rows) => {
  box.replaceChildren();
  const data = etapasVisiveis(rows, 14);
  if (!data.length) return vazio(box, 'Nenhuma mudança de etapa no período.');
  const W = Math.max(280, box.clientWidth);
  const row = 32, top = 2, Hh = top + data.length * row;
  const svg = svgIn(box, W, Hh);
  const probe = svg.append('g');
  let labelW = 0;
  for (const d of data) { const t = probe.append('text').attr('class', 'lbl').text(d.etapa); labelW = Math.max(labelW, t.node().getComputedTextLength()); }
  const numW = probe.append('text').text(fmt.int(d3.max(data, (d) => Number(d.leads)))).node().getComputedTextLength();
  probe.remove();
  labelW = Math.min(labelW, W * 0.4);
  const L = labelW + 14, R = numW + 14;
  const max = d3.max(data, (d) => Math.max(Number(d.leads), Number(d.leads_ant))) || 1;
  const x = d3.scaleLinear([0, max], [L, W - R]);
  const g = svg.append('g').selectAll('g').data(data).join('g').attr('transform', (_, i) => `translate(0,${top + i * row})`);
  g.append('rect').attr('x', L).attr('y', 6).attr('height', 14).attr('width', W - R - L).attr('rx', 7).style('fill', 'rgba(255,255,255,.035)');
  g.append('text').attr('class', 'lbl').attr('x', L - 14).attr('y', 13).attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
    .text((d) => d.etapa).each(function () { const e = this; while (e.getComputedTextLength() > labelW && e.textContent.length > 4) e.textContent = e.textContent.slice(0, -2) + '…'; });
  g.append('rect').attr('x', L).attr('y', 6).attr('height', 14).attr('rx', 7)
    .attr('width', (d) => Math.max(Number(d.leads) > 0 ? 4 : 0, x(Number(d.leads)) - L)).style('fill', ACC)
    .style('fill-opacity', (d) => 0.45 + 0.55 * (Number(d.leads) / max));
  g.append('rect').attr('x', L).attr('y', 24).attr('height', 2).attr('rx', 1)
    .attr('width', (d) => Math.max(0, x(Number(d.leads_ant)) - L)).style('fill', MUTED).style('fill-opacity', 0.55);
  g.append('text').attr('x', (d) => x(Number(d.leads)) + 8).attr('y', 13).attr('dominant-baseline', 'middle').text((d) => fmt.int(d.leads));
  const tip = tipOf(box);
  g.append('rect').attr('width', W).attr('height', row).style('fill', 'transparent')
    .on('mousemove', (event, d) => showTip(box, tip, event, d.etapa, [[ACC, 'Período atual', fmt.int(d.leads)], [MUTED, 'Período anterior', fmt.int(d.leads_ant)]]))
    .on('mouseleave', () => hideTip(tip));
};

/* Mapa de calor: dia da semana × hora */
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const NOMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
export const horarios = (box, rows) => {
  box.replaceChildren();
  if (!rows.length) return vazio(box, 'Sem atendimentos no período.');
  const map = new Map(rows.map((r) => [Number(r.dia_semana) + ':' + Number(r.hora), r]));
  const W = Math.max(280, box.clientWidth);
  const L = 36, T = 2, B = 24, cw = (W - L) / 24, ch = Math.max(18, Math.min(32, cw * 1.15)), Hh = T + ch * 7 + B;
  const svg = svgIn(box, W, Hh);
  const max = d3.max(rows, (r) => Number(r.atendimentos)) || 1;
  const alpha = (v) => 0.1 + 0.9 * Math.sqrt(v / max);
  DIAS.forEach((d, i) => svg.append('text').attr('x', L - 8).attr('y', T + i * ch + ch / 2).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').text(d));
  const every = cw < 16 ? 6 : cw < 26 ? 3 : 2;
  for (let h = 0; h < 24; h += every) svg.append('text').attr('x', L + h * cw + cw / 2).attr('y', Hh - 6).attr('text-anchor', 'middle').text(h + 'h');
  const cells = [];
  for (let d = 1; d <= 7; d++) for (let h = 0; h < 24; h++) cells.push({ d, h, r: map.get(d + ':' + h) });
  const tip = tipOf(box);
  const rects = svg.append('g').selectAll('rect').data(cells).join('rect')
    .attr('x', (c) => L + c.h * cw + 1.5).attr('y', (c) => T + (c.d - 1) * ch + 1.5)
    .attr('width', Math.max(1, cw - 3)).attr('height', Math.max(1, ch - 3)).attr('rx', Math.min(5, cw / 4))
    .style('fill', (c) => (c.r ? ACC : 'rgba(255,255,255,.03)'))
    .style('fill-opacity', (c) => (c.r ? alpha(Number(c.r.atendimentos)) : 1))
    .on('mousemove', (event, c) => {
      rects.style('stroke', (o) => (o === c ? '#f7f8f8' : 'none')).attr('stroke-width', 1);
      const r = c.r;
      const s = r && Number(r.respondidos) > 0 ? fmt.pct((100 * Number(r.dentro_sla)) / Number(r.respondidos)) : '—';
      showTip(box, tip, event, NOMES[c.d - 1] + ', ' + c.h + 'h–' + (c.h + 1) + 'h', [[ACC, 'Atendimentos', r ? fmt.int(r.atendimentos) : '0'], [null, 'Respondidos no SLA', s]]);
    })
    .on('mouseleave', () => { rects.style('stroke', 'none'); hideTip(tip); });
};

/* Veículos: barra de leads com a parte que avançou destacada */
export const veiculos = (box, rows) => {
  box.replaceChildren();
  const data = (rows || []).filter((d) => Number(d.leads) > 0).slice(0, 12);
  if (!data.length) return vazio(box, 'Nenhum lead com anúncio identificado no período.');
  const W = Math.max(280, box.clientWidth);
  const row = 30, top = 2, Hh = top + data.length * row;
  const svg = svgIn(box, W, Hh);
  const probe = svg.append('g');
  let labelW = 0;
  for (const d of data) { const t = probe.append('text').attr('class', 'lbl').text(d.veiculo); labelW = Math.max(labelW, t.node().getComputedTextLength()); }
  const numW = probe.append('text').text(fmt.int(d3.max(data, (d) => Number(d.leads)))).node().getComputedTextLength();
  probe.remove();
  labelW = Math.min(labelW, W * 0.42);
  const L = labelW + 14, R = numW + 14;
  const max = d3.max(data, (d) => Number(d.leads)) || 1;
  const x = d3.scaleLinear([0, max], [L, W - R]);
  const g = svg.append('g').selectAll('g').data(data).join('g').attr('transform', (_, i) => `translate(0,${top + i * row})`);
  g.append('rect').attr('x', L).attr('y', 7).attr('height', 14).attr('width', W - R - L).attr('rx', 7).style('fill', 'rgba(255,255,255,.035)');
  g.append('text').attr('class', 'lbl').attr('x', L - 14).attr('y', 14).attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
    .text((d) => d.veiculo).each(function () { const e = this; while (e.getComputedTextLength() > labelW && e.textContent.length > 4) e.textContent = e.textContent.slice(0, -2) + '…'; });
  g.append('rect').attr('x', L).attr('y', 7).attr('height', 14).attr('rx', 7)
    .attr('width', (d) => Math.max(4, x(Number(d.leads)) - L)).style('fill', ACC).style('fill-opacity', 0.85);
  g.append('rect').attr('x', L).attr('y', 7).attr('height', 14).attr('rx', 7)
    .attr('width', (d) => (Number(d.avancaram) > 0 ? Math.max(4, x(Number(d.avancaram)) - L) : 0)).style('fill', DEEP);
  g.append('text').attr('x', (d) => x(Number(d.leads)) + 8).attr('y', 14).attr('dominant-baseline', 'middle').text((d) => fmt.int(d.leads));
  const tip = tipOf(box);
  g.append('rect').attr('width', W).attr('height', row).style('fill', 'transparent')
    .on('mousemove', (event, d) => showTip(box, tip, event, d.veiculo, [
      [ACC, 'Leads', fmt.int(d.leads)], [DEEP, 'Avançaram', fmt.int(d.avancaram) + ' (' + fmt.pct(d.taxa_avanco) + ')'],
      [null, 'Responderam', fmt.int(d.respondidos)], [null, 'Vendas', fmt.int(d.vendas)], [null, 'Anúncios', fmt.int(d.anuncios)],
      ...(isNum(d.preco) && Number(d.preco) > 0 ? [[null, 'Preço anunciado', fmt.brl0(d.preco)]] : []),
    ]))
    .on('mouseleave', () => hideTip(tip));
};
