// Registra o resultado do pedido de ligar/desligar
const SB = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const SK = String($env.SUPABASE_SECRET_KEY || '');
const ped = $('Pedidos pendentes').item.json;
const r = $input.item.json || {};
const err = $input.item.error || r.error;
const ok = !err && (r.id || r.active !== undefined);
const msg = ok ? (ped.acao === 'ligar' ? 'Ligada no n8n' : 'Desligada no n8n') : String(err?.message || err?.description || JSON.stringify(err || r)).slice(0, 400);
await this.helpers.httpRequest({ method: 'POST', url: SB + '/rest/v1/rpc/atend_service_pedido_fim', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' }, body: { p_id: ped.id, p_ok: !!ok, p_resultado: msg }, json: true, timeout: 30000 });
return { json: { pedido: ped.id, ok: !!ok, msg } };
