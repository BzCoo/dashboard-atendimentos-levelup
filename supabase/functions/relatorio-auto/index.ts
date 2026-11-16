// Edge Function: relatorio-auto
// Chamada a cada minuto pela fila do n8n. Pega os relatórios agendados que venceram, monta o texto com o
// MESMO código do site (relatorio-texto.js, copiado de assets/js) e põe na fila de envio do grupo de CRM.
// Não recebe parâmetros: só processa o que já está agendado no banco, então pode ser chamada sem login.
import { createClient } from "npm:@supabase/supabase-js@2";
import { montarTexto } from "./relatorio-texto.js";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const dia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
const menos = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

Deno.serve(async () => {
  const { data: devidos, error } = await sb.rpc("atend_service_relatorios_devidos");
  if (error) return json({ erro: error.message }, 500);
  const feitos: unknown[] = [];
  for (const a of (devidos ?? []) as Array<{ loja_id: number; dias_periodo: number; opcoes: Record<string, unknown> }>) {
    try {
      const fim = menos(dia(new Date()), 1), ini = menos(fim, Math.max(1, a.dias_periodo) - 1);
      const { data: d, error: e } = await sb.rpc("atend_service_relatorio_dados", { p_conta: a.loja_id, p_inicio: ini, p_fim: fim, p_comparar: "anterior" });
      if (e) throw new Error(e.message);
      if (!d?.kpis) throw new Error("Sem dados da loja no período");
      const escopo = Object.assign(new String(d.nome || "Loja"), { multi: false });
      const texto = montarTexto(
        { kpis: d.kpis, etapas: d.etapas, vendedores: d.vendedores, horarios: d.horarios, porLoja: [], inv: d.inv, ads: d.ads, traf: d.traf },
        { ...a.opcoes, meta: d.meta ?? null, obs: "" },
        escopo,
      );
      const { error: e2 } = await sb.rpc("atend_service_relatorio_enfileirar", { p_conta: a.loja_id, p_texto: texto });
      if (e2) throw new Error(e2.message);
      feitos.push({ loja: a.loja_id, ok: true });
    } catch (er) {
      const msg = er instanceof Error ? er.message : String(er);
      await sb.rpc("atend_service_relatorio_enfileirar", { p_conta: a.loja_id, p_texto: "", p_ok: false, p_erro: msg });
      feitos.push({ loja: a.loja_id, ok: false, erro: msg });
    }
  }
  return json({ ok: true, feitos });
});
