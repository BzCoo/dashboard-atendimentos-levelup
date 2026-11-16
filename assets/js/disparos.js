/* Central LevelUp › Disparos: mensagens para os grupos de CRM (agora, agendadas ou recorrentes).
   O banco guarda o disparo; a fila do n8n (a cada minuto) transforma em envios, 5 por minuto, entre 7h e 21h. */
import { $, $$, el, clone, rpc, fmt, toast } from './core.js?v=202611161817';

const DIAS = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const STATUS = { pendente: ['Na fila', ''], enviando: ['Enviando', ''], enviado: ['Enviado', ' ok'], falhou: ['Falhou', ' off'], incerto: ['Sem confirmação', ' warn'] };

/* *negrito* e _itálico_ do WhatsApp, sem HTML */
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
const descRec = (r) => {
  if (!r) return 'Uma vez';
  const d = [...(r.dias || [])].map(Number).sort();
  const dias = d.join() === '1,2,3,4,5' ? 'Seg a sex' : d.join() === '1,2,3,4,5,6,7' ? 'Todo dia' : d.join() === '1,2,3,4,5,6' ? 'Seg a sáb' : d.map((x) => DIAS[x]).join(', ');
  return dias + ' às ' + r.hora;
};
const localISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const renderDisparos = async (main) => {
  main.replaceChildren(clone('tpl-disparos'));
  const form = $('.f-dsp', main), texto = $('.f-texto', main), selModelo = $('.f-modelo', main), selPrev = $('.f-previa', main);
  const boxG = $('.slot-grupos', main), qG = $('.q-grupos', main), msg = $('.lu-msg', form), btn = $('.act-disparar', form);
  let dados = { grupos: [], modelos: [], agendados: [], historico: [] };
  const marcados = new Set();

  /* ---------- Grupos ---------- */
  const nomeG = (g) => g.nome + (g.pausado ? ' (pausado)' : '');
  const desenharGrupos = () => {
    const t = qG.value.trim().toLowerCase();
    const lista = dados.grupos.filter((g) => !t || [g.nome, g.empresa, g.loja].join(' ').toLowerCase().includes(t));
    boxG.replaceChildren(...(lista.length ? lista.map((g) => {
      const cb = el('input', { type: 'checkbox', class: 'lu-check', value: g.jid, disabled: g.pausado });
      cb.checked = marcados.has(g.jid);
      return el('label', { class: 'lu-dsp-g' + (g.pausado ? ' off' : '') }, cb, el('span', {}, el('b', { text: nomeG(g) }), g.empresa ? el('small', { text: g.empresa + (g.loja ? ' · ' + g.loja : '') }) : null));
    }) : [el('p', { class: 'muted', text: 'Nenhum grupo encontrado.' })]));
    contarG();
  };
  const contarG = () => {
    $('.slot-gcont', main).textContent = marcados.size ? marcados.size + (marcados.size === 1 ? ' marcado' : ' marcados') : 'nenhum marcado';
    const atual = selPrev.value;
    const opts = dados.grupos.filter((g) => marcados.has(g.jid));
    selPrev.replaceChildren(...opts.map((g) => el('option', { value: g.jid, text: g.nome })));
    if (opts.some((g) => g.jid === atual)) selPrev.value = atual;
    selPrev.hidden = !opts.length;
    agendarPrevia();
  };
  boxG.addEventListener('change', (e) => { const c = e.target; if (c.checked) marcados.add(c.value); else marcados.delete(c.value); contarG(); });
  qG.addEventListener('input', desenharGrupos);
  $('.act-gtodos', main).addEventListener('click', () => { $$('input', boxG).forEach((c) => { if (!c.disabled) { c.checked = true; marcados.add(c.value); } }); contarG(); });
  $('.act-gnenhum', main).addEventListener('click', () => { marcados.clear(); $$('input', boxG).forEach((c) => { c.checked = false; }); contarG(); });

  /* ---------- Prévia (variáveis trocadas pelo banco para o grupo escolhido) ---------- */
  const prevBox = $('.slot-previa', main);
  let tPrev = null, nPrev = 0;
  const agendarPrevia = () => { clearTimeout(tPrev); tPrev = setTimeout(previa, 450); };
  const previa = async () => {
    const t = texto.value.trim(), jid = selPrev.value;
    if (!t || !jid) { prevBox.replaceChildren(el('p', { class: 'muted', text: t ? 'Marque um grupo para ver a prévia.' : 'Escreva a mensagem e escolha um grupo.' })); return; }
    const n = ++nPrev;
    try {
      const r = await rpc('atend_disparo_previa', { p_texto: t, p_jid: jid });
      if (n !== nPrev) return;
      const span = el('span'); formatar(span, r || '');
      prevBox.replaceChildren(el('div', { class: 'lu-bubble' }, span, el('small', { text: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date()) })));
    } catch (e) { if (n === nPrev) prevBox.replaceChildren(el('p', { class: 'lu-msg erro', text: e.message })); }
  };
  texto.addEventListener('input', agendarPrevia);
  selPrev.addEventListener('change', previa);
  $('.lu-dsp-vars', main).addEventListener('click', (e) => {
    const b = e.target.closest('[data-var]'); if (!b) return;
    const v = b.dataset.var, ini = texto.selectionStart ?? texto.value.length, fim = texto.selectionEnd ?? ini;
    texto.setRangeText(v, ini, fim, 'end'); texto.focus(); agendarPrevia();
  });

  /* ---------- Quando ---------- */
  const modo = () => $('input[name=quando]:checked', form).value;
  const syncModo = () => {
    $('.f-agendar-box', form).hidden = modo() !== 'agendar';
    $('.f-repetir-box', form).hidden = modo() !== 'repetir';
    btn.textContent = modo() === 'agora' ? 'Enviar agora' : modo() === 'agendar' ? 'Agendar' : 'Salvar repetição';
  };
  $$('input[name=quando]', form).forEach((r) => r.addEventListener('change', syncModo));
  const amanha8 = new Date(); amanha8.setDate(amanha8.getDate() + 1); amanha8.setHours(8, 0, 0, 0);
  $('.f-data', form).value = localISO(amanha8);
  $('.f-data', form).min = localISO(new Date());

  /* ---------- Modelos ---------- */
  const desenharModelos = (sel) => {
    selModelo.replaceChildren(el('option', { value: '', text: 'Começar do zero' }), ...dados.modelos.map((m) => el('option', { value: m.id, text: m.nome })));
    if (sel) selModelo.value = String(sel);
    $('.act-apagar-modelo', main).hidden = !selModelo.value;
  };
  selModelo.addEventListener('change', () => {
    const m = dados.modelos.find((x) => String(x.id) === selModelo.value);
    if (m) { texto.value = m.texto; agendarPrevia(); }
    $('.act-apagar-modelo', main).hidden = !m;
  });
  $('.act-salvar-modelo', main).addEventListener('click', async () => {
    if (!texto.value.trim()) return toast('Escreva a mensagem antes de salvar o modelo.', true);
    const atual = dados.modelos.find((x) => String(x.id) === selModelo.value);
    const nome = prompt(atual ? 'Nome do modelo (mantenha para atualizar o atual):' : 'Nome do modelo:', atual?.nome || '');
    if (!nome) return;
    try {
      const r = await rpc('atend_disparo_modelo_salvar', { p_id: atual && atual.nome === nome ? atual.id : null, p_nome: nome, p_texto: texto.value });
      await carregar(); desenharModelos(r.id); toast('Modelo salvo.');
    } catch (e) { toast(e.message, true); }
  });
  $('.act-apagar-modelo', main).addEventListener('click', async () => {
    const m = dados.modelos.find((x) => String(x.id) === selModelo.value); if (!m) return;
    if (!confirm('Apagar o modelo "' + m.nome + '"?')) return;
    try { await rpc('atend_disparo_modelo_remover', { p_id: m.id }); await carregar(); desenharModelos(); toast('Modelo apagado.'); } catch (e) { toast(e.message, true); }
  });

  /* ---------- Enviar / agendar ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); msg.hidden = true;
    const erro = (t) => { msg.textContent = t; msg.hidden = false; };
    if (!texto.value.trim()) return erro('Escreva a mensagem.');
    if (!marcados.size) return erro('Marque ao menos um grupo.');
    const args = { p_texto: texto.value, p_grupos: [...marcados], p_quando: null, p_recorrencia: null, p_titulo: dados.modelos.find((x) => String(x.id) === selModelo.value)?.nome || null };
    if (modo() === 'agendar') {
      const v = $('.f-data', form).value; if (!v) return erro('Escolha o dia e a hora.');
      args.p_quando = new Date(v).toISOString();
    }
    if (modo() === 'repetir') {
      const dias = $$('.lu-dsp-dias input:checked', form).map((c) => Number(c.value));
      if (!dias.length) return erro('Marque ao menos um dia da semana.');
      args.p_recorrencia = { dias, hora: $('.f-hora', form).value || '08:00' };
    }
    const n = marcados.size;
    if (!confirm((modo() === 'agora' ? 'Enviar agora para ' : modo() === 'agendar' ? 'Agendar para ' : 'Repetir para ') + n + (n === 1 ? ' grupo?' : ' grupos?'))) return;
    btn.disabled = true;
    try {
      const r = await rpc('atend_disparo_criar', args);
      toast(modo() === 'agora' ? 'Disparo na fila: sai no próximo minuto (5 grupos por minuto).' : 'Agendado para ' + fmt.dt(r.quando) + '.');
      if (modo() === 'agora') { marcados.clear(); }
      await carregar(); desenharGrupos();
    } catch (er) { erro(er.message); }
    btn.disabled = false;
  });

  /* ---------- Agendados, histórico e pausa ---------- */
  const desenharAgendados = () => {
    const box = $('.slot-agendados', main), ag = dados.agendados || [];
    if (!ag.length) { box.replaceChildren(el('p', { class: 'muted lu-dsp-vazio', text: 'Nada agendado.' })); return; }
    box.replaceChildren(el('div', { class: 'lu-dsp-ags' }, ...ag.map((d) => el('article', { class: 'lu-dsp-ag' + (d.status === 'pausado' ? ' off' : ''), 'data-id': d.id },
      el('div', { class: 'lu-dsp-ag-topo' },
        el('b', { text: d.titulo || (d.texto.split('\n')[0].slice(0, 60) + (d.texto.length > 60 ? '…' : '')) }),
        el('span', { class: 'lu-badge' + (d.status === 'pausado' ? ' off' : ''), text: d.status === 'pausado' ? 'Pausado' : descRec(d.recorrencia) })),
      el('p', { class: 'muted', text: (d.status === 'pausado' ? 'Pausado' : 'Próximo: ' + fmt.dt(d.quando)) + ' · ' + d.n_grupos + (d.n_grupos === 1 ? ' grupo' : ' grupos') + (d.envios_feitos ? ' · já saiu ' + d.envios_feitos + 'x' : '') + (d.por ? ' · por ' + d.por : '') }),
      el('div', { class: 'lu-actions' },
        el('button', { type: 'button', class: 'lu-ghost sm', 'data-ag': d.status === 'pausado' ? 'retomar' : 'pausar', text: d.status === 'pausado' ? 'Retomar' : 'Pausar' }),
        el('button', { type: 'button', class: 'lu-ghost sm danger', 'data-ag': 'cancelar', text: 'Cancelar' }))))));
  };
  $('.slot-agendados', main).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ag]'); if (!b) return;
    const id = Number(b.closest('[data-id]').dataset.id);
    if (b.dataset.ag === 'cancelar' && !confirm('Cancelar este disparo? Ele não sai mais.')) return;
    try { await rpc('atend_disparo_acao', { p_id: id, p_acao: b.dataset.ag }); await carregar(); toast(b.dataset.ag === 'cancelar' ? 'Disparo cancelado.' : b.dataset.ag === 'pausar' ? 'Disparo pausado.' : 'Disparo retomado.'); } catch (er) { toast(er.message, true); }
  });
  const desenharHist = () => {
    const h = dados.historico || [];
    $('#tb-dsp-hist tbody', main).replaceChildren(...(h.length ? h.map((x) => {
      const [rot, cls] = STATUS[x.status] || [x.status, ''];
      return el('tr', { 'data-envio': x.id },
        el('td', { class: 'txt mono', text: fmt.dt(x.enviado_em || x.criado_em) }),
        el('td', { class: 'txt name', text: String(x.grupo || '').replace(/^[^A-Za-z0-9À-ú]+/, '') }),
        el('td', { class: 'txt hide-sm muted wrap lu-dsp-trecho', text: x.texto, title: x.erro || '' }),
        el('td', { class: 'txt' }, el('span', { class: 'lu-badge' + cls, text: rot, title: x.erro || '' })),
        el('td', { class: 'txt hide-sm', text: x.por || '—' }),
        el('td', {}, ['falhou', 'incerto'].includes(x.status) ? el('button', { type: 'button', class: 'lu-ghost sm', 'data-reenviar': x.id, text: 'Reenviar' }) : null));
    }) : [el('tr', {}, el('td', { class: 'txt muted', colspan: 6, text: 'Nenhum envio ainda.' }))]));
  };
  $('#tb-dsp-hist', main).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-reenviar]'); if (!b) return;
    if (!confirm('Reenviar esta mensagem? Se ela ficou "sem confirmação", confira antes no grupo para não duplicar.')) return;
    try { await rpc('atend_disparo_reenviar', { p_envio: b.dataset.reenviar }); await carregar(); toast('Reenvio na fila.'); } catch (er) { toast(er.message, true); }
  });
  const desenharPausa = () => {
    $('.slot-pausa', main).replaceChildren(...dados.grupos.map((g) => {
      const cb = el('input', { type: 'checkbox', class: 'lu-switch', role: 'switch', 'data-jid': g.jid, 'aria-label': 'Receber disparos em ' + g.nome });
      cb.checked = !g.pausado;
      return el('label', { class: 'lu-ctl-conta' }, el('span', { text: g.nome }), el('small', { class: 'muted', text: g.pausado ? 'Pausado' : 'Recebe' }), cb);
    }));
  };
  $('.slot-pausa', main).addEventListener('change', async (e) => {
    const cb = e.target.closest('[data-jid]'); if (!cb) return;
    cb.disabled = true;
    try {
      await rpc('atend_grupo_pausar', { p_jid: cb.dataset.jid, p_pausado: !cb.checked });
      const g = dados.grupos.find((x) => x.jid === cb.dataset.jid); if (g) g.pausado = !cb.checked;
      if (g?.pausado) marcados.delete(g.jid);
      cb.parentElement.querySelector('small').textContent = cb.checked ? 'Recebe' : 'Pausado';
      desenharGrupos(); toast(cb.checked ? 'Grupo liberado.' : 'Grupo pausado.');
    } catch (er) { cb.checked = !cb.checked; toast(er.message, true); }
    cb.disabled = false;
  });

  const carregar = async () => {
    dados = await rpc('atend_disparos');
    desenharAgendados(); desenharHist(); desenharPausa();
  };

  boxG.replaceChildren(el('p', { class: 'muted', text: 'Carregando grupos…' }));
  try { await carregar(); desenharModelos(); desenharGrupos(); }
  catch (e) { boxG.replaceChildren(el('div', { class: 'lu-fail', text: e.message })); }
  syncModo();
  const t = setInterval(() => { if (!document.hidden) rpc('atend_disparos').then((d) => { dados = { ...d, grupos: dados.grupos.length ? dados.grupos : d.grupos }; desenharAgendados(); desenharHist(); }).catch(() => {}); }, 30000);
  return () => clearInterval(t);
};
