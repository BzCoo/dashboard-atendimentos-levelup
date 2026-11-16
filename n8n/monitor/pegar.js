// Lê no banco o catálogo de automações e os pedidos de ligar/desligar feitos na Central
const SB = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const SK = String($env.SUPABASE_SECRET_KEY || '');
if (!SB || !SK) throw new Error('Supabase nao configurado (SUPABASE_URL / SUPABASE_SECRET_KEY)');
const r = await this.helpers.httpRequest({ method: 'POST', url: SB + '/rest/v1/rpc/atend_service_monitor_pegar', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' }, body: {}, json: true, timeout: 30000 });
return [{ json: r }];
