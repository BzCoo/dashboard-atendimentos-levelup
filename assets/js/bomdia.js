/* Central LevelUp › Bom dia: textos de segunda a sexta, liga/desliga e grupos que recebem.
   Quem envia é o fluxo n8n "WhatsApp - Bom dia grupos etiqueta CRM" (9h15), que lê esta configuração no banco. */
import { $, $$, el, clone, rpc, fmt, toast } from './core.js?v=202611231234';

const DIAS = { segunda: 'segunda', terca: 'terça', quarta: 'quarta', quinta: 'quinta', sexta: 'sexta' };
const formatar = (alvo, texto) => {
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

export const renderBomDia = async (main) => {
  main.replaceChildren(clone('tpl-bomdia'));
  const form = $('.f-bd', main), ta = $('.f-bd-texto', main), sw = $('.f-bd-ativo', main), boxG = $('.slot-grupos', main), selPrev = $('.f-previa', main);
  const hojeIdx = Math.min(Math.max(new Date().getDay(), 1), 5);
  let dia = ['', 'segunda', 'terca', 'quarta', 'quinta', 'sexta'][hojeIdx];
  let textos = {}, excluidos = new Set(), grupos = [], sujo = false;

  const marcarSujo = (v = true) => { sujo = v; $('.slot-bd-sujo', main).textContent = v ? 'Alterações não salvas' : ''; };
  const estado = () => { $('.slot-bd-estado', main).textContent = sw.checked ? 'Ligado' : 'Desligado'; };
  const trocarDia = (d, salvarAtual = true) => {
    if (salvarAtual) textos[dia] = ta.value;
    dia = d;
    $$('.lu-bd-tabs [data-dia]', main).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.dia === d)));
    $('.slot-bd-rot', main).textContent = 'Mensagem de ' + DIAS[d];
    ta.value = textos[d] || ''; agendarPrevia();
  };
  $('.lu-bd-tabs', main).addEventListener('click', (e) => { const b = e.target.closest('[data-dia]'); if (b) trocarDia(b.dataset.dia); });
  ta.addEventListener('input', () => { textos[dia] = ta.value; marcarSujo(); agendarPrevia(); });
  sw.addEventListener('change', () => { estado(); marcarSujo(); });
  $('.lu-dsp-vars', main).addEventListener('click', (e) => {
    const b = e.target.closest('[data-var]'); if (!b) return;
    const ini = ta.selectionStart ?? ta.value.length, fim = ta.selectionEnd ?? ini;
    ta.setRangeText(b.dataset.var, ini, fim, 'end'); ta.focus(); textos[dia] = ta.value; marcarSujo(); agendarPrevia();
  });

  const desenharGrupos = () => {
    boxG.replaceChildren(...(grupos.length ? grupos.map((g) => {
      const cb = el('input', { type: 'checkbox', class: 'lu-check', value: g.jid, disabled: g.pausado });
      cb.checked = !excluidos.has(g.jid) && !g.pausado;
      const det = [g.etiqueta ? 'com etiqueta CRM' : 'grupo do painel', g.pausado ? 'pausado em Disparos' : null, g.ultimo_preparo ? 'último bom dia ' + fmt.dt(g.ultimo_preparo) : null].filter(Boolean).join(' · ');
      return el('label', { class: 'lu-dsp-g' + (g.pausado ? ' off' : '') }, cb, el('span', {}, el('b', { text: g.nome }), el('small', { text: det })));
    }) : [el('p', { class: 'muted', text: 'Nenhum grupo ainda.' })]));
    const n = grupos.filter((g) => !excluidos.has(g.jid) && !g.pausado).length;
    $('.slot-gcont', main).textContent = n + ' de ' + grupos.length + ' recebem';
    const atual = selPrev.value;
    selPrev.replaceChildren(...grupos.filter((g) => !excluidos.has(g.jid)).map((g) => el('option', { value: g.jid, text: g.nome })));
    if (atual) selPrev.value = atual;
  };
  boxG.addEventListener('change', (e) => { const c = e.target; if (c.checked) excluidos.delete(c.value); else excluidos.add(c.value); marcarSujo(); desenharGrupos(); agendarPrevia(); });
  $('.act-gtodos', main).addEventListener('click', () => { excluidos.clear(); marcarSujo(); desenharGrupos(); });
  $('.act-gnenhum', main).addEventListener('click', () => { grupos.forEach((g) => excluidos.add(g.jid)); marcarSujo(); desenharGrupos(); });

  const prevBox = $('.slot-previa', main);
  let tPrev = null, nPrev = 0;
  const agendarPrevia = () => { clearTimeout(tPrev); tPrev = setTimeout(previa, 400); };
  const previa = async () => {
    const t = ta.value.trim(), jid = selPrev.value;
    if (!t) { prevBox.replaceChildren(el('p', { class: 'muted', text: 'Sem texto para ' + DIAS[dia] + ': nesse dia o bom dia não sai.' })); return; }
    if (!jid) { prevBox.replaceChildren(el('p', { class: 'muted', text: 'Marque um grupo para ver a prévia.' })); return; }
    const n = ++nPrev;
    try {
      const r = await rpc('atend_bomdia_previa', { p_texto: t, p_jid: jid });
      if (n !== nPrev) return;
      const span = el('span'); formatar(span, r || '');
      prevBox.replaceChildren(el('div', { class: 'lu-bubble' }, span, el('small', { text: '09:15' })));
    } catch (e) { if (n === nPrev) prevBox.replaceChildren(el('p', { class: 'lu-msg erro', text: e.message })); }
  };
  selPrev.addEventListener('change', previa);

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); textos[dia] = ta.value;
    const b = $('.act-bd-salvar', form); b.disabled = true;
    try {
      await rpc('atend_bomdia_salvar', { p_ativo: sw.checked, p_textos: textos, p_excluidos: [...excluidos] });
      marcarSujo(false); toast('Bom dia salvo. Vale a partir do próximo envio (9h15).');
    } catch (er) { const m = $('.lu-msg', form); m.textContent = er.message; m.hidden = false; }
    b.disabled = false;
  });
  const sair = (e) => { if (sujo) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', sair);

  try {
    const d = await rpc('atend_bomdia');
    const c = d.config || {};
    textos = { ...(c.textos || {}) }; excluidos = new Set(c.excluidos || []); grupos = d.grupos || [];
    sw.checked = c.ativo !== false; estado();
    $('.slot-bd-info', main).textContent = (c.ultimo_envio ? 'Último envio: ' + fmt.dt(c.ultimo_envio) + ' para ' + (c.ultimo_total ?? '?') + ' grupos. ' : '')
      + (d.lista_do_whatsapp ? '' : 'A lista exata dos grupos com etiqueta CRM chega do WhatsApp no próximo envio; por enquanto aparecem os grupos de CRM do painel.');
    desenharGrupos(); trocarDia(dia, false); marcarSujo(false);
  } catch (e) { boxG.replaceChildren(el('div', { class: 'lu-fail', text: e.message })); }
  return () => window.removeEventListener('beforeunload', sair);
};
