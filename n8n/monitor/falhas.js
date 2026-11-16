// Pega o id da falha mais recente de cada automação, só quando ela é nova (a mensagem de erro já lida fica guardada no banco)
const cat = $('Pegar catalogo e pedidos').first().json.automacoes || [];
const execs = $('Execucoes recentes').all().map((i) => i.json).filter((e) => e && e.id);
const out = [];
for (const a of cat) {
  const ids = a.workflows || [];
  const ex = execs.filter((e) => ids.includes(e.workflowId) && ['success', 'error', 'crashed'].includes(e.status))
    .sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt));
  const falha = ex.find((e) => e.status !== 'success');
  if (!falha) continue;
  const jaLida = a.ultima_falha && Date.parse(a.ultima_falha) >= Date.parse(falha.startedAt);
  if (!jaLida) out.push({ json: { wf: falha.workflowId, exec_id: String(falha.id) } });
}
return out.length ? out : [{ json: { vazio: true } }];
