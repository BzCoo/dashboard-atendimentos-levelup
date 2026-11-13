// Conexão pública com o Supabase. A chave publicável pode ficar no navegador:
// todo acesso aos dados passa por funções do banco que conferem o login e a loja de cada usuário.
export const SUPABASE_URL = 'https://jlhhlqvukhmdeomnvcnf.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_FgLVOWk8hlf-42DfNPSCGw_ihBAjxl5';
export const FUNCAO_ADMIN = 'atend-admin';
// Fluxo do n8n que busca os grupos do WhatsApp (só ADM; o fluxo confere o login)
export const N8N_GRUPOS = 'https://n8n.gabrielcamposia.cloud/webhook/dash-atend-grupos';
