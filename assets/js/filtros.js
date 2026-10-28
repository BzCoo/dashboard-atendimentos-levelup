import { $, clone, PRESETS, intervalo, presetDe, trocarFiltros } from './core.js?v=202610281531';

/* Barra de filtros (loja + período). Mudanças vão para a URL, que recarrega a página atual. */
export const montarFiltros = (slot, ctx, rota) => {
  slot.replaceChildren(clone('tpl-filtros'));
  const selLoja = $('.f-loja', slot), selPreset = $('.f-preset', slot);
  const inIni = $('.f-ini', slot), inFim = $('.f-fim', slot);
  const f = ctx.filtros;

  const lojas = ctx.me.lojas || [];
  const opcoes = [];
  if (lojas.length > 1) opcoes.push(new Option(ctx.admin ? 'Todas as lojas' : 'Todas as minhas lojas', ''));
  for (const l of lojas) opcoes.push(new Option(String(l.loja), String(l.loja_id)));
  selLoja.replaceChildren(...opcoes);
  selLoja.value = f.conta ? String(f.conta) : (lojas.length === 1 ? String(lojas[0].loja_id) : '');
  if (lojas.length <= 1) selLoja.disabled = true;

  selPreset.replaceChildren(...PRESETS.map(([v, t]) => new Option(t, v)));
  selPreset.value = presetDe(f.inicio, f.fim);
  inIni.value = f.inicio; inFim.value = f.fim;

  const aplicar = (mud) => trocarFiltros(rota, { ...f, ...mud });
  selLoja.addEventListener('change', () => aplicar({ conta: selLoja.value ? Number(selLoja.value) : null }));
  selPreset.addEventListener('change', () => {
    if (selPreset.value === 'custom') { inIni.focus(); return; }
    const r = intervalo(selPreset.value);
    if (r) aplicar({ inicio: r[0], fim: r[1] });
  });
  const datas = () => {
    const a = inIni.value, b = inFim.value;
    if (!a || !b || !inIni.validity.valid || !inFim.validity.valid) return;
    aplicar(a > b ? { inicio: b, fim: a } : { inicio: a, fim: b });
  };
  inIni.addEventListener('change', datas);
  inFim.addEventListener('change', datas);
  $('.f-reset', slot).addEventListener('click', () => { const r = intervalo('7'); trocarFiltros(rota, { conta: null, inicio: r[0], fim: r[1] }); });
};
