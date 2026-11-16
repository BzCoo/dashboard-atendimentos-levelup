// Calcula a saúde de cada automação, grava no banco e manda os alertas para o grupo BackLog Automações
const SB = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const SK = String($env.SUPABASE_SECRET_KEY || '');
const call = async (fn, body) => await this.helpers.httpRequest({ method: 'POST', url: SB + '/rest/v1/rpc/' + fn, headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' }, body, json: true, timeout: 30000 });
const dados = $('Pegar catalogo e pedidos').first().json;
const cat = dados.automacoes || [];
const wfs = {};
for (const i of $('Listar workflows').all()) { const w = i.json || {}; if (w.id) wfs[w.id] = w; }
const execs = $('Execucoes recentes').all().map((i) => i.json).filter((e) => e && e.id && e.mode !== 'manual');
const erros = {};
// O detalhe do erro NÃO é lido pela API (a execução completa pode ter vários MB e derrubar o n8n): guarda só o número da execução
for (const i of $('Ultima falha de cada um').all()) {
  const j = i.json || {};
  if (j.wf && j.exec_id) erros[j.wf] = 'Falhou na execução #' + j.exec_id + ' (abra no n8n para ver o erro)';
}
const agora = Date.now();
const H24 = 24 * 3600e3;
const hhmm = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const [hh, mm] = hhmm.split(':').map(Number);
const minDia = hh * 60 + mm;
const checaAtraso = minDia >= 8 * 60 + 30 && minDia <= 22 * 60 + 30;   // fora disso não acusa atraso (a carga dorme de madrugada)
const mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const estado = [];
for (const a of cat) {
  const ids = a.workflows || [];
  const principal = wfs[ids[0]];
  const ligada = principal ? !!principal.active : false;   // fora da lista = não publicada
  const ex = execs.filter((e) => ids.includes(e.workflowId)).sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt));
  const fim = ex.filter((e) => ['success', 'error', 'crashed'].includes(e.status));
  const ok = fim.filter((e) => e.status === 'success');
  const ruins = fim.filter((e) => e.status !== 'success');
  const d24 = fim.filter((e) => agora - Date.parse(e.startedAt) < H24);
  // Ritmo pelo gatilho do principal (ignora as chamadas internas, ex.: a carga chama a si mesma conta a conta)
  const doPrincipal = ex.filter((e) => e.workflowId === ids[0]);
  const gatilho = doPrincipal.filter((e) => e.mode !== 'integrated');
  const base = (gatilho.length >= 2 ? gatilho : doPrincipal).map((e) => Date.parse(e.startedAt));
  const gaps = []; for (let i = 0; i + 1 < base.length && i < 20; i++) gaps.push((base[i] - base[i + 1]) / 60000);
  const gapsOk = gaps.filter((g) => g > 0.2);
  const intervalo = mediana(gapsOk);
  const p90 = gapsOk.length ? [...gapsOk].sort((x, y) => x - y)[Math.min(gapsOk.length - 1, Math.floor(gapsOk.length * 0.9))] : null;
  const durs = ok.slice(0, 20).map((e) => (Date.parse(e.stoppedAt) - Date.parse(e.startedAt)) / 1000).filter((x) => x >= 0);
  const ultimaExec = ex[0] ? ex[0].startedAt : null;
  const ultSucesso = ok[0] ? (ok[0].stoppedAt || ok[0].startedAt) : null;
  let situacao = 'saudavel';
  if (ligada === false) situacao = 'desligada';
  else if (!fim.length) situacao = a.sob_demanda ? 'saudavel' : 'sem_execucoes';
  else if (fim[0].status !== 'success' && (fim.length === 1 || fim[1].status !== 'success')) situacao = 'falhando';
  else if (!a.sob_demanda && checaAtraso && ligada) {
    // tolerância: a do catálogo ou 1,5x a maior pausa habitual (p90), para não acusar quem roda em rajadas
    const tol = Number(a.tolerancia_min) || (p90 ? Math.max(15, p90 * 1.5) : null);
    const ultGatilho = base[0] ? new Date(base[0]).toISOString() : ultimaExec;
    const desde = ultGatilho ? (agora - Date.parse(ultGatilho)) / 60000 : Infinity;
    if (tol && desde > tol) situacao = 'atrasada';
  }
  const item = {
    id: a.id, ligada, situacao, versao_publicada: principal?.activeVersionId || null,
    ultima_execucao: ultimaExec, ultimo_status: ex[0]?.status || null, ultimo_sucesso: ultSucesso,
    ultima_falha: ruins[0] ? ruins[0].startedAt : null,
    execucoes_24h: d24.length, falhas_24h: d24.filter((e) => e.status !== 'success').length,
    duracao_media_s: durs.length ? Math.round(durs.reduce((s, x) => s + x, 0) / durs.length) : null,
    intervalo_min: intervalo ? Math.round(intervalo) : null,
  };
  const er = ids.map((w) => erros[w]).find(Boolean);
  if (er) item.ultimo_erro = er; else if (situacao === 'saudavel') item.ultimo_erro = null;
  estado.push(item);
}
const alertas = await call('atend_service_monitor_salvar', { p_estado: estado });
const quando = (iso) => iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : 'nunca';
const linhas = [];
for (const x of alertas || []) {
  if (x.voltou) { linhas.push('✅ *' + x.nome + '* voltou ao normal' + (x.situacao === 'desligada' ? ' (desligada)' : '') + '.'); continue; }
  if (x.situacao === 'falhando') linhas.push('🔴 *' + x.nome + '* está falhando' + (x.critica ? ' (crítica)' : '') + '.\nÚltimo erro: ' + (x.erro || 'sem detalhe') + '\nÚltimo sucesso: ' + quando(x.ultimo_sucesso));
  if (x.situacao === 'atrasada') linhas.push('🟡 *' + x.nome + '* está atrasada: último sucesso ' + quando(x.ultimo_sucesso) + (x.intervalo_min ? ' (normal: a cada ~' + x.intervalo_min + ' min)' : '') + '.');
}
// Primeira rodada do Monitor: só registra a situação atual, sem alertar (evita uma enxurrada de avisos antigos)
const primeira = !dados.monitor_em;
if (linhas.length && !primeira) await call('atend_service_alerta', { p_texto: '🤖 *Monitor de automações*\n\n' + linhas.join('\n\n') + '\n\nDetalhes na Central LevelUp → Automações.' });
// Resumo diário às 8h30
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
let resumo = false;
if (!primeira && minDia >= 8 * 60 + 30 && minDia < 9 * 60 && dados.resumo_enviado !== hoje) {
  const c = { saudavel: 0, atrasada: 0, falhando: 0, desligada: 0 };
  estado.forEach((e) => { if (c[e.situacao] !== undefined) c[e.situacao]++; });
  const ruins = estado.filter((e) => ['falhando', 'atrasada'].includes(e.situacao)).map((e) => (e.situacao === 'falhando' ? '🔴 ' : '🟡 ') + (cat.find((a) => a.id === e.id)?.nome || e.id));
  const falhas = estado.reduce((s, e) => s + (e.falhas_24h || 0), 0);
  await call('atend_service_alerta', { p_texto: '☀️ *Automações: resumo do dia*\n🟢 ' + c.saudavel + ' saudáveis · 🟡 ' + c.atrasada + ' atrasadas · 🔴 ' + c.falhando + ' falhando · ⚪ ' + c.desligada + ' desligadas\nFalhas nas últimas 24h: ' + falhas + (ruins.length ? '\n\nPrecisam de atenção:\n' + ruins.join('\n') : '\n\nTudo certo por aqui. 👌') });
  await call('atend_service_resumo_marcar', { p_dia: hoje });
  resumo = true;
}
return [{ json: { automacoes: estado.length, alertas: (alertas || []).length, primeira, resumo } }];
