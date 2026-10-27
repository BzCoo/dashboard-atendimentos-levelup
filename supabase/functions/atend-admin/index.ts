// Edge Function: atend-admin
// Cria acessos (login com e-mail e senha) e redefine senhas para o site
// "Dashboard de Atendimentos - Level Up". Só administradores ativos podem chamar.
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
  if (!me || me.papel !== "admin") return json({ erro: "Somente administradores podem fazer isso." }, 403);
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
    if (papel !== "admin" && papel !== "loja") return json({ erro: "Perfil inválido." }, 400);
    if (papel === "loja" && lojas.length === 0) return json({ erro: "Escolha ao menos uma loja." }, 400);

    let userId: string | null = null;
    let jaExistia = false;
    const { data: existente } = await admin.rpc("atend_service_user_id", { p_email: email });
    if (existente) {
      userId = existente as string;
      jaExistia = true; // usuário já tinha login (ex.: outro painel): mantém a senha dele
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

  if (acao === "senha") {
    const membro = String(body.membro_id ?? "");
    const senha = String(body.senha ?? "");
    if (senha.length < 8) return json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);
    const { data: alvo } = await admin.rpc("atend_service_membro_user", { p_membro: membro });
    if (!alvo) return json({ erro: "Acesso não encontrado." }, 404);
    const { error: sErr } = await admin.auth.admin.updateUserById(alvo as string, { password: senha });
    if (sErr) return json({ erro: "Não foi possível trocar a senha: " + sErr.message }, 400);
    await admin.rpc("atend_service_registrar", { p_admin: adminId, p_acao: "redefinir_senha", p_detalhe: { membro } });
    return json({ ok: true });
  }

  return json({ erro: "Ação desconhecida." }, 400);
});
