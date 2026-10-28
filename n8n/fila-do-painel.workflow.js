import { workflow, node, trigger, sticky } from '@n8n/workflow-sdk';

const cadaMinuto = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'A cada minuto',
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } },
    position: [0, 0]
  },
  output: [{}]
});

const buscar = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Buscar envios e sincronizar etapas',
    position: [260, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const SB = String($env.SUPABASE_URL || '').replace(/\\/$/, '');\nconst SK = String($env.SUPABASE_SECRET_KEY || '');\nif (!SB || !SK) throw new Error('Supabase nao configurado (SUPABASE_URL / SUPABASE_SECRET_KEY)');\nconst call = async (name, body, profile) => {\n  const h = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };\n  if (profile) { h['Content-Profile'] = profile; h['Accept-Profile'] = profile; }\n  return await this.helpers.httpRequest({ method: 'POST', url: SB + '/rest/v1/rpc/' + name, headers: h, body, json: true, timeout: 30000 });\n};\nconst erro = (e) => String(e?.response?.body?.message || e?.message || e || 'erro').slice(0, 300);\n\n// 1) Mensagens pendentes do painel (o grupo ja vem resolvido pelo banco)\nlet envios = [];\ntry {\n  const r = await call('atend_service_envios_pegar', { p_limite: 5 });\n  envios = Array.isArray(r) ? r : [];\n} catch (e) { throw new Error('Falha ao ler a fila de envios: ' + erro(e)); }\n\n// 2) Nomes das etapas do CRM (1x por dia ou quando o ADM pede). Nao bloqueia os envios.\ntry {\n  const s = await call('atend_service_sync_pegar', {});\n  if (s && s.fazer) {\n    const res = { contas: 0, etapas: 0, falhas: [] };\n    const contas = Array.isArray(s.contas) ? s.contas : [];\n    const umaConta = async (c) => {\n      try {\n        const token = await call('get_ghl_account_token', { p_account_id: Number(c.id) }, 'metrics_dev');\n        if (typeof token !== 'string' || !token) throw new Error('token ausente');\n        const p = await this.helpers.httpRequest({ method: 'GET', url: 'https://services.leadconnectorhq.com/opportunities/pipelines', qs: { locationId: c.location_id }, headers: { Authorization: 'Bearer ' + token, Version: '2021-07-28', Accept: 'application/json' }, json: true, timeout: 30000 });\n        const pipe = (p.pipelines || []).find((x) => x.id === c.pipeline_id);\n        if (!pipe) throw new Error('pipeline principal nao encontrado');\n        const etapas = (pipe.stages || []).map((st) => ({ id: st.id, name: st.name, position: st.position }));\n        const n = await call('atend_service_salvar_etapas', { p_loja: Number(c.id), p_etapas: etapas });\n        res.contas++; res.etapas += Number(n) || 0;\n      } catch (e) { res.falhas.push({ conta: c.id, erro: erro(e) }); }\n    };\n    for (let i = 0; i < contas.length; i += 4) await Promise.all(contas.slice(i, i + 4).map(umaConta));\n    await call('atend_service_sync_fim', { p_sync_id: s.sync_id, p_ok: res.contas > 0, p_resultado: res });\n  }\n} catch (e) { /* a sincronizacao nunca impede os envios */ }\n\nreturn envios.map((e) => ({ json: { id: e.id, grupo_jid: e.grupo_jid, texto: e.texto } }));"
    }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000000', grupo_jid: '120363000000000000@g.us', texto: 'Mensagem' }]
});

const registrar = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Registrar resultado do envio',
    position: [780, 0],
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: "const SB = String($env.SUPABASE_URL || '').replace(/\\/$/, '');\nconst SK = String($env.SUPABASE_SECRET_KEY || '');\nconst call = async (name, body) => await this.helpers.httpRequest({ method: 'POST', url: SB + '/rest/v1/rpc/' + name, headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' }, body, json: true, timeout: 30000 });\nconst envio = $('Buscar envios e sincronizar etapas').item.json;\nconst r = $input.item.json || {};\nconst info = r?.data?.data?.Info;\nconst id = info?.ID || r?.data?.key?.id || null;\nconst ok = r?.success === true && typeof id === 'string' && id.length > 0 && (!info?.Chat || info.Chat === envio.grupo_jid);\nconst code = Number(r?.statusCode || r?.error?.statusCode || r?.error?.httpCode || 0);\nconst rejeitado = !ok && [400, 401, 403, 404, 413, 422].includes(code);\nconst status = ok ? 'enviado' : rejeitado ? 'falhou' : 'incerto';\nconst msg = ok ? null : String(r?.error?.message || r?.message || (typeof r?.error === 'string' ? r.error : '') || 'Sem confirmacao do WhatsApp; confira o grupo antes de reenviar').slice(0, 400);\nawait call('atend_service_envio_resultado', { p_id: envio.id, p_status: status, p_provider_id: ok ? id : null, p_erro: msg });\nreturn { json: { id: envio.id, status, erro: msg } };"
    }
  },
  output: [{ id: '00000000-0000-0000-0000-000000000000', status: 'enviado', erro: null }]
});

const nota = sticky('## Fila do Dashboard de Atendimentos\nO site grava a mensagem em dash_atend.envios (o grupo é resolvido no banco a partir da loja). A cada minuto este fluxo pega até 5 pendentes, envia pelo Stevo e registra enviado / falhou / incerto. Envios sem confirmação NÃO são reenviados automaticamente.\n\nO mesmo passo também sincroniza os nomes das etapas do CRM (GHL) uma vez por dia ou quando o ADM pede em Administração → Etapas.', [cadaMinuto, buscar, registrar], { color: 4 });

export default workflow('dash-atend-fila', 'DASH ATENDIMENTOS - Fila do painel (WhatsApp e etapas)')
  .add(cadaMinuto)
  .to(buscar)
  .to(registrar)
  .add(nota);
