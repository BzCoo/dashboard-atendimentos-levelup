/* Central LevelUp › Automações: saúde e liga/desliga das automações do n8n (só Dev).
   O Monitor (n8n, a cada 5 min) grava a situação no banco e aplica os pedidos feitos aqui. */
import { $, $$, el, clone, rpc, fmt, toast } from './core.js?v=202611161820';

const N8N = 'https://n8n.gabrielcamposia.cloud/workflow/';
const SIT = {
  saudavel: ['Saudável', 'ok'], atrasada: ['Atrasada', 'warn'], falhando: ['Falhando', 'bad'],
  desligada: ['Desligada', 'off'], sem_execucoes: ['Sem execuções', 'warn'], desconhecida: ['Aguardando o Monitor', 'off'],
};
const CAMPOS = { pipeline_automation_enabled: 'Pipeline Inteligente', attendance_automation_enabled: 'Varredura Aguardando', weekly_report_enabled: 'Relatório semanal' };
const RODAR = { carga_banco: 'carga_banco', pipeline: 'pipeline', aguardando: 'aguardando', origem_anuncio: 'origem_anuncio', relatorio_ia: 'relatorio_ia' };

const ha = (iso) => {
  if (!iso) return 'nunca';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'agora há pouco';
  if (m < 60) return 'há ' + m + ' min';
  const h = Math.floor(m / 60);
  if (h < 48) return 'há ' + h + 'h' + (m % 60 && h < 6 ? String(m % 60).padStart(2, '0') : '');
  return 'há ' + Math.floor(h / 24) + ' dias';
};
const ritmo = (min) => {
  const n = Number(min);
  if (!n) return null;
  if (n < 2) return 'a cada minuto';
  if (n < 90) return 'a cada ~' + Math.round(n) + ' min';
  if (n < 1380) return 'a cada ~' + Math.round(n / 60) + 'h';
  if (n < 2000) return '1x por dia';
  return 'a cada ~' + Math.round(n / 1440) + ' dias';
};
const dur = (s) => (s === null || s === undefined ? null : Number(s) < 60 ? Math.round(s) + ' s' : Math.round(Number(s) / 60) + ' min');

export const renderControle = async (main, ctx) => {
  main.replaceChildren(clone('tpl-controle'));
  const dlg = $('#dlg-ctl'), form = $('.f-ctl', dlg), dlgC = $('#dlg-ctl-contas');
  let dados = null, timer = null, vivo = true;
  $$('.act-cancelar', dlg).forEach((b) => { b.onclick = () => dlg.close(); });
  $$('.act-cancelar', dlgC).forEach((b) => { b.onclick = () => dlgC.close(); });

  const pedidoPendente = (id) => (dados?.pedidos || []).find((p) => p.automacao_id === id && p.status === 'pendente');

  const cartao = (a) => {
    const [rot, cls] = SIT[a.situacao] || SIT.desconhecida;
    const pend = pedidoPendente(a.id);
    const meta = [
      a.ultima_execucao ? 'Última execução ' + ha(a.ultima_execucao) + (a.ultimo_status && a.ultimo_status !== 'success' ? ' (' + (a.ultimo_status === 'running' ? 'rodando' : 'com erro') + ')' : '') : 'Ainda não rodou',
      a.ultimo_sucesso ? 'último sucesso ' + ha(a.ultimo_sucesso) : null,
      a.sob_demanda ? 'sob demanda' : ritmo(a.intervalo_min),
      Number(a.execucoes_24h) ? fmt.int(a.falhas_24h) + ' falha' + (Number(a.falhas_24h) === 1 ? '' : 's') + ' em ' + fmt.int(a.execucoes_24h) + (Number(a.execucoes_24h) === 1 ? ' execução' : ' execuções') + ' (24h)' : null,
      dur(a.duracao_media_s) ? 'leva ~' + dur(a.duracao_media_s) : null,
    ].filter(Boolean);
    const ligada = a.ligada !== false;
    const btn = a.protegida
      ? el('span', { class: 'muted lu-ctl-prot', text: 'Sempre ligado' })
      : el('button', { type: 'button', class: (ligada ? 'lu-ghost' : 'lu-primary') + ' sm', 'data-act': ligada ? 'desligar' : 'ligar', disabled: !!pend, text: pend ? (pend.acao === 'ligar' ? 'Ligando…' : 'Desligando…') : ligada ? 'Desligar' : 'Ligar' });
    return el('article', { class: 'lu-ctl-card ' + cls, 'data-id': a.id },
      el('div', { class: 'lu-ctl-linha' },
        el('span', { class: 'lu-ctl-sit ' + cls }, el('i', { 'aria-hidden': 'true' }), rot),
        el('h3', { text: a.nome }),
        a.critica ? el('span', { class: 'lu-badge', text: 'crítica', title: 'Desligar pede confirmação dupla' }) : null),
      el('p', { class: 'lu-ctl-desc', text: a.descricao }),
      el('p', { class: 'lu-ctl-meta', text: meta.join(' · ') }),
      a.ultimo_erro && a.situacao !== 'saudavel' ? el('p', { class: 'lu-ctl-erro' }, el('b', { text: 'Último erro: ' }), a.ultimo_erro) : null,
      pend ? el('p', { class: 'lu-ctl-pend', text: 'Pedido de ' + pend.acao + ' por ' + (pend.por || 'você') + ' · o Monitor aplica em até 5 minutos.' }) : null,
      el('div', { class: 'lu-actions' },
        btn,
        a.campo_conta ? el('button', { type: 'button', class: 'lu-ghost sm', 'data-act': 'contas', text: 'Por conta' }) : null,
        a.rodar_tipo && RODAR[a.rodar_tipo] ? el('a', { class: 'lu-ghost sm', href: '#/rodar', 'data-rota': 'rodar', text: 'Rodar agora' }) : null,
        el('a', { class: 'lu-ghost sm', href: N8N + a.workflows[0], target: '_blank', rel: 'noopener', text: 'Abrir no n8n ↗' })));
  };

  const desenhar = () => {
    const autos = dados.automacoes || [];
    const cont = { saudavel: 0, atrasada: 0, falhando: 0, desligada: 0 };
    autos.forEach((a) => { const k = a.situacao === 'sem_execucoes' ? 'atrasada' : a.situacao; if (cont[k] !== undefined) cont[k]++; });
    $('.slot-resumo', main).replaceChildren(
      el('span', { class: 'ok' }, el('b', { text: String(cont.saudavel) }), ' saudáveis'),
      el('span', { class: 'warn' }, el('b', { text: String(cont.atrasada) }), ' atrasadas'),
      el('span', { class: 'bad' }, el('b', { text: String(cont.falhando) }), ' falhando'),
      el('span', { class: 'off' }, el('b', { text: String(cont.desligada) }), ' desligadas'));
    const mon = dados.monitor?.em;
    const atrasoMon = mon && Date.now() - Date.parse(mon) > 15 * 60000;
    $('.slot-ver', main).textContent = mon ? 'Monitor conferiu ' + ha(mon) : 'O Monitor ainda não rodou';
    $('.slot-ver', main).classList.toggle('bad', !mon || atrasoMon);
    const s = dados.sinais || {};
    $('.slot-grupo', main).textContent = s.grupo_alertas || 'BackLog Automações';
    const sinal = (n, rot, dica, href) => el(href ? 'a' : 'div', { class: 'lu-ctl-sinal ' + (Number(n) ? 'bad' : 'ok'), href, 'data-rota': href ? href.slice(2) : undefined, title: dica },
      el('b', { text: fmt.int(n) }), el('span', { text: rot }));
    $('.slot-sinais', main).replaceChildren(
      sinal(s.contas_carga_falhou, 'contas com a última carga falhando', 'Contas ativas cuja última carga do banco não terminou com sucesso', '#/saude'),
      sinal(s.contas_token, 'contas com token do GHL inválido', 'Erro de autorização (401/403) na última carga', '#/saude'),
      sinal(s.openai_sem_credito, 'contas sem crédito da OpenAI', 'Pipeline Inteligente com erro de cota/crédito nos últimos 2 dias'),
      sinal(s.fila_parada, 'mensagens paradas na fila', 'Envios pendentes há mais de 15 minutos'),
      sinal(s.whatsapp_falhas_24h, 'envios do WhatsApp falharam (24h)', 'Envios do painel que o WhatsApp recusou nas últimas 24h'));
    const grupos = [...new Set(autos.map((a) => a.grupo))];
    $('.slot-grupos', main).replaceChildren(...grupos.map((g) => el('section', { class: 'lu-section lu-ctl-grupo' },
      el('div', { class: 'lu-head' }, el('div', {}, el('h2', { class: 'lu-h3', text: g }))),
      el('div', { class: 'lu-ctl-lista' }, ...autos.filter((a) => a.grupo === g).map(cartao)))));
    const hist = dados.pedidos || [];
    $('#tb-ctl-hist tbody', main).replaceChildren(...(hist.length ? hist.map((p) => el('tr', {},
      el('td', { class: 'txt mono', text: fmt.dt(p.em) }),
      el('td', { class: 'txt name', text: p.nome }),
      el('td', { class: 'txt' }, el('span', { class: 'lu-badge' + (p.acao === 'desligar' ? ' off' : ''), text: p.acao === 'ligar' ? 'Ligar' : 'Desligar' })),
      el('td', { class: 'txt', text: p.por || '—' }),
      el('td', { class: 'txt hide-sm muted wrap', text: p.motivo || '—' }),
      el('td', { class: 'txt' + (p.status === 'erro' ? ' lu-ctl-erro-txt' : ' muted'), text: p.status === 'pendente' ? 'Aguardando o Monitor' : p.resultado || p.status })))
      : [el('tr', {}, el('td', { class: 'txt muted', colspan: 6, text: 'Nenhum pedido ainda.' }))]));
  };

  const carregar = async (silencioso) => {
    try { dados = await rpc('atend_dev_automacoes'); desenhar(); }
    catch (e) { if (!silencioso) $('.slot-grupos', main).replaceChildren(el('div', { class: 'lu-fail', text: e.message })); }
  };

  /* Ligar / desligar */
  const pedir = (a, acao) => {
    const msg = $('.lu-msg', form);
    form.reset(); msg.hidden = true;
    $('#dlg-ctl-t').textContent = (acao === 'ligar' ? 'Ligar ' : 'Desligar ') + a.nome + '?';
    $('.slot-sub', dlg).textContent = a.descricao;
    $('.slot-aviso', dlg).textContent = acao === 'ligar'
      ? 'Ela volta a rodar na versão publicada antes de ser desligada. O Monitor aplica em até 5 minutos.'
      : 'Ela para de rodar sozinha até alguém ligar de novo. O Monitor aplica em até 5 minutos e avisa no grupo de alertas.';
    $('.f-motivo-box', form).hidden = false;
    $('.f-conf-box', form).hidden = !(acao === 'desligar' && a.critica);
    $('.act-confirmar', form).textContent = acao === 'ligar' ? 'Ligar' : 'Desligar';
    $('.act-confirmar', form).classList.toggle('danger', acao === 'desligar');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const b = $('.act-confirmar', form);
      b.disabled = true;
      try {
        await rpc('atend_dev_automacao_pedir', { p_id: a.id, p_acao: acao, p_motivo: form.motivo.value.trim() || null, p_confirmacao: form.conf.value || null });
        dlg.close(); toast('Pedido registrado. O Monitor aplica em até 5 minutos.');
        await carregar();
      } catch (er) { msg.textContent = er.message; msg.hidden = false; }
      b.disabled = false;
    };
    dlg.showModal();
    if (matchMedia('(pointer: fine)').matches) form.motivo.focus();
  };

  /* Por conta */
  const porConta = (a) => {
    const campo = a.campo_conta, q = $('.q-ctl-contas', dlgC), box = $('.slot-contas', dlgC);
    $('#dlg-ctl-contas-t').textContent = (CAMPOS[campo] || a.nome) + ' por conta';
    const desenharContas = () => {
      const t = q.value.trim().toLowerCase();
      const contas = (dados.contas || []).filter((c) => !t || String(c.loja).toLowerCase().includes(t));
      box.replaceChildren(...contas.map((c) => {
        const cb = el('input', { type: 'checkbox', class: 'lu-switch', role: 'switch', 'data-loja': c.loja_id, 'aria-label': (CAMPOS[campo] || a.nome) + ' em ' + c.loja });
        cb.checked = !!c[campo];
        return el('label', { class: 'lu-ctl-conta' }, el('span', { text: c.loja }), el('small', { class: 'muted', text: cb.checked ? 'Ligada' : 'Desligada' }), cb);
      }));
    };
    box.onchange = async (e) => {
      const cb = e.target.closest('input[data-loja]'); if (!cb) return;
      const loja = Number(cb.dataset.loja), valor = cb.checked;
      cb.disabled = true;
      try {
        await rpc('atend_dev_automacao_conta', { p_loja: loja, p_campo: campo, p_valor: valor });
        const c = dados.contas.find((x) => Number(x.loja_id) === loja); if (c) c[campo] = valor;
        cb.parentElement.querySelector('small').textContent = valor ? 'Ligada' : 'Desligada';
        toast((valor ? 'Ligada' : 'Desligada') + ' para ' + (c?.loja || 'a conta') + '.');
      } catch (er) { cb.checked = !valor; toast(er.message, true); }
      cb.disabled = false;
    };
    q.value = ''; q.oninput = desenharContas; desenharContas();
    dlgC.showModal();
  };

  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = (dados?.automacoes || []).find((x) => x.id === b.closest('[data-id]')?.dataset.id); if (!a) return;
    if (b.dataset.act === 'contas') porConta(a); else pedir(a, b.dataset.act);
  });
  $('.act-atualizar', main).addEventListener('click', () => carregar());

  $('.slot-grupos', main).replaceChildren(el('div', { class: 'lu-shell' }, el('div', { class: 'lu-core sk', text: 'Carregando…' })));
  await carregar();
  const ciclo = () => { if (!vivo) return; timer = setTimeout(async () => { if (!document.hidden && !dlg.open && !dlgC.open) await carregar(true); ciclo(); }, 60000); };
  ciclo();
  return () => { vivo = false; clearTimeout(timer); };
};
