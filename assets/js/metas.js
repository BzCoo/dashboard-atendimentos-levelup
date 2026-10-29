import { $, el, clone, rpc, fmt, isNum, toast } from './core.js?v=202610291203';

const CAMPOS = [['sla', 'meta_sla', 0.1, 100], ['resposta', 'meta_resposta', 0.1, 100], ['tempo', 'meta_tempo_min', 0.1, null], ['custo', 'meta_custo_atend', 0.01, null]];
const lerNum = (v) => { const t = String(v ?? '').trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : NaN; };
const args = (loja, vals) => ({ p_loja: loja, p_sla: vals.sla, p_resposta: vals.resposta, p_tempo: vals.tempo, p_custo: vals.custo });
const validar = (vals) => {
  for (const [k, , , max] of CAMPOS) {
    if (Number.isNaN(vals[k])) return 'Use apenas números positivos.';
    if (max && vals[k] !== null && vals[k] > max) return 'Porcentagens vão de 0 a 100.';
  }
  return null;
};

export const renderMetas = async (main, ctx) => {
  main.replaceChildren(clone('tpl-metas'));
  const fp = $('#f-meta-padrao', main), tbody = $('#tb-metas tbody', main), busca = $('.q-metas', main);
  let dados = { padrao: null, lojas: [] };

  const recarregarCtx = async () => { try { ctx.metas = await rpc('atend_metas'); } catch { /* segue */ } };

  const draw = () => {
    const p = dados.padrao || {};
    for (const [k, col] of CAMPOS) fp[k].value = isNum(p[col]) ? String(p[col]) : '';
    const t = busca.value.trim().toLowerCase();
    const lojas = (dados.lojas || []).filter((l) => !t || String(l.loja).toLowerCase().includes(t));
    if (!lojas.length) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt muted', colspan: 6, text: 'Nada encontrado.' }))); return; }
    tbody.replaceChildren(...lojas.map((l) => {
      const m = l.personalizada ? l : {};
      const tr = el('tr', { 'data-id': String(l.loja_id) }, el('td', { class: 'txt name', text: l.loja }));
      for (const [k, col, step, max] of CAMPOS) {
        const inp = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: String(step), name: k, 'aria-label': k + ' — ' + l.loja, placeholder: isNum(p[col]) ? String(p[col]) : '—' });
        if (max) inp.max = String(max);
        inp.value = isNum(m[col]) ? String(m[col]) : '';
        tr.append(el('td', {}, inp));
      }
      tr.append(el('td', {}, el('div', { class: 'lu-actions' },
        el('button', { type: 'button', class: 'lu-ghost sm', 'data-act': 'salvar', text: 'Salvar' }),
        l.personalizada ? el('button', { type: 'button', class: 'lu-ghost sm', 'data-act': 'limpar', text: 'Limpar' }) : null)));
      return tr;
    }));
  };
  const carregar = async () => {
    tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt sk', colspan: 6, text: 'Carregando…' })));
    try { dados = await rpc('atend_admin_metas') || dados; dados.lojas ||= []; draw(); }
    catch (e) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 6 }, el('div', { class: 'lu-fail', text: e.message })))); }
  };
  busca.addEventListener('input', draw);

  fp.addEventListener('submit', async (e) => {
    e.preventDefault();
    const vals = Object.fromEntries(CAMPOS.map(([k]) => [k, lerNum(fp[k].value)]));
    const erro = validar(vals); if (erro) return toast(erro, true);
    const b = $('button[type=submit]', fp); b.disabled = true;
    try { await rpc('atend_admin_salvar_meta', args(0, vals)); toast('Meta padrão salva.'); await carregar(); await recarregarCtx(); }
    catch (er) { toast(er.message, true); }
    b.disabled = false;
  });
  tbody.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const tr = b.closest('tr'), loja = Number(tr.dataset.id);
    const vals = Object.fromEntries(CAMPOS.map(([k]) => [k, b.dataset.act === 'limpar' ? null : lerNum($('input[name=' + k + ']', tr).value)]));
    const erro = validar(vals); if (erro) return toast(erro, true);
    b.disabled = true;
    try {
      await rpc('atend_admin_salvar_meta', args(loja, vals));
      toast(b.dataset.act === 'limpar' ? 'A loja voltou a usar a meta padrão.' : 'Meta da loja salva.');
      await carregar(); await recarregarCtx();
    } catch (er) { toast(er.message, true); b.disabled = false; }
  });
  tbody.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); $('button[data-act=salvar]', e.target.closest('tr'))?.click(); } });
  await carregar();
};
