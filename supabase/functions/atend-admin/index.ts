// Edge Function: atend-admin
// Cria acessos (login com e-mail e senha) e redefine senhas para o site
// "Dashboard de Atendimentos - Level Up". Só a equipe (Dev ou Gestor) pode chamar;
// Gestor só cria e redefine senha de acessos de cliente (perfil "loja").
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ erro: "Faça login novamente." }, 401);

  // Quem está chamando precisa ser admin ativo
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: me, error: meErr } = await asUser.rpc("atend_me");
  if (meErr) return json({ erro: "Não foi possível verificar seu acesso." }, 401);
  if (!me || (me.papel !== "admin" && me.papel !== "gestor")) return json({ erro: "Somente a equipe LevelUp pode fazer isso." }, 403);
  const souDev = me.papel === "admin";
  const { data: userData } = await asUser.auth.getUser();
  const adminId = userData?.user?.id ?? null;

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const acao = String(body.acao ?? "");

  if (acao === "criar") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const nome = String(body.nome ?? "").trim();
    const papel = String(body.papel ?? "");
    const senha = String(body.senha ?? "");
    const lojas = Array.isArray(body.lojas) ? body.lojas.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!EMAIL.test(email)) return json({ erro: "E-mail inválido." }, 400);
    if (!nome) return json({ erro: "Informe o nome." }, 400);
    if (papel !== "admin" && papel !== "gestor" && papel !== "loja") return json({ erro: "Perfil inválido." }, 400);
    if (!souDev && papel !== "loja") return json({ erro: "Somente devs podem criar acessos da equipe." }, 403);
    if (papel === "loja" && lojas.length === 0) return json({ erro: "Escolha ao menos uma loja." }, 400);

    let userId: string | null = null;
    let jaExistia = false;
    const { data: existente } = await admin.rpc("atend_service_user_id", { p_email: email });
    if (existente) {
      userId = existente as string;
      if (!souDev) {
        const { data: papelAtual } = await admin.rpc("atend_service_papel", { p_user: userId });
        if (papelAtual === "admin" || papelAtual === "gestor") return json({ erro: "Este e-mail é de alguém da equipe. Só um dev pode mudar." }, 403);
      }
      jaExistia = true; // usuário já tinha login (ex.: outro painel): mantém a senha dele
      // Login antigo que nunca foi confirmado nem usado: confirma o e-mail e aplica a senha informada agora
      const { data: u } = await admin.auth.admin.getUserById(userId);
      if (u?.user && !u.user.email_confirmed_at && !u.user.last_sign_in_at) {
        const attrs: Record<string, unknown> = { email_confirm: true };
        if (senha.length >= 8) attrs.password = senha;
        const { error: uErr } = await admin.auth.admin.updateUserById(userId, attrs);
        if (uErr) return json({ erro: "Não foi possível ativar o login existente: " + uErr.message }, 400);
        jaExistia = senha.length < 8;
      }
    } else {
      if (senha.length < 8) return json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);
      const { data: criado, error: cErr } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true, user_metadata: { nome },
      });
      if (cErr || !criado?.user) return json({ erro: "Não foi possível criar o login: " + (cErr?.message ?? "erro") }, 400);
      userId = criado.user.id;
    }
    const { data: membroId, error: vErr } = await admin.rpc("atend_service_vincular", {
      p_user_id: userId, p_nome: nome, p_papel: papel, p_lojas: lojas, p_admin: adminId,
    });
    if (vErr) return json({ erro: "Login criado, mas o vínculo falhou: " + vErr.message }, 500);
    return json({ ok: true, membro_id: membroId, ja_existia: jaExistia });
  }

  // Convite por e-mail para cliente (perfil "loja"): cria o login sem senha e o Supabase manda o link para a pessoa criar a dela
  if (acao === "convidar") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const nome = String(body.nome ?? "").trim() || email.split("@")[0];
    const lojas = Array.isArray(body.lojas) ? body.lojas.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    const volta = String(body.redireciona ?? "");
    if (!EMAIL.test(email)) return json({ erro: "E-mail inválido." }, 400);
    if (!lojas.length) return json({ erro: "Escolha ao menos uma loja." }, 400);
    if (!/^https:\/\/[a-z0-9-]+\.github\.io\//i.test(volta)) return json({ erro: "Endereço de volta inválido." }, 400);
    let userId: string | null = null;
    let convidado = false;
    const { data: existente } = await admin.rpc("atend_service_user_id", { p_email: email });
    if (existente) {
      userId = existente as string;
      const { data: papelAtual } = await admin.rpc("atend_service_papel", { p_user: userId });
      if (papelAtual === "admin" || papelAtual === "gestor") return json({ erro: "Este e-mail é de alguém da equipe." }, 403);
    } else {
      const { data: conv, error: iErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: volta, data: { nome } });
      if (iErr || !conv?.user) return json({ erro: "Não foi possível enviar o convite: " + (iErr?.message ?? "erro") }, 400);
      userId = conv.user.id; convidado = true;
    }
    // Quem já é cliente ganha as lojas novas sem perder as que já tinha
    const { data: papelHoje } = await admin.rpc("atend_service_papel", { p_user: userId });
    const { data: membroId, error: vErr } = papelHoje === "loja"
      ? await admin.rpc("atend_service_somar_lojas", { p_user: userId, p_lojas: lojas, p_admin: adminId })
      : await admin.rpc("atend_service_vincular", { p_user_id: userId, p_nome: nome, p_papel: "loja", p_lojas: lojas, p_admin: adminId });
    if (vErr) return json({ erro: "Convite feito, mas o vínculo falhou: " + vErr.message }, 500);
    return json({ ok: true, membro_id: membroId, convidado, ja_existia: !convidado });
  }

  if (acao === "senha") {
    const membro = String(body.membro_id ?? "");
    const senha = String(body.senha ?? "");
    if (senha.length < 8) return json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);
    const { data: alvo } = await admin.rpc("atend_service_membro_user", { p_membro: membro });
    if (!alvo) return json({ erro: "Acesso não encontrado." }, 404);
    if (!souDev) {
      const { data: papelAlvo } = await admin.rpc("atend_service_papel", { p_user: alvo as string });
      if (papelAlvo !== "loja") return json({ erro: "Somente devs podem trocar a senha de alguém da equipe." }, 403);
    }
    const { error: sErr } = await admin.auth.admin.updateUserById(alvo as string, { password: senha, email_confirm: true });
    if (sErr) return json({ erro: "Não foi possível trocar a senha: " + sErr.message }, 400);
    await admin.rpc("atend_service_registrar", { p_admin: adminId, p_acao: "redefinir_senha", p_detalhe: { membro } });
    return json({ ok: true });
  }

  return json({ erro: "Ação desconhecida." }, 400);
});
