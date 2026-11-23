// Nó "Preparar alerta de saldo" do workflow [META-ADS-REPORT] ALERTA PIX SALDO (w4yxo6vmh96aCUhj).
// Recebe as contas atualizadas na rodada do workflow de saldo e pergunta ao banco quais estão abaixo do limite
// definido na Central LevelUp → Tráfego → Saldos (padrão: pré-paga abaixo de R$ 200; Royal Motors até R$ 3.000).
const envelope = $input.first().json;
if (envelope.workflow_origem !== 'FXVLATfQ51kPEPSj' || !envelope.rodada_id || !Array.isArray(envelope.contas)) throw new Error('Rodada de atualização inválida');
const ids = [...new Set(envelope.contas.filter((c) => c && c.id != null && c.rodada_id === envelope.rodada_id).map((c) => Number(c.id)).filter(Number.isFinite))];
const SB = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const SK = String($env.SUPABASE_SECRET_KEY || '');
const contas = ids.length ? await this.helpers.httpRequest({ method: 'POST', url: SB + '/rest/v1/rpc/atend_service_saldo_alertas', headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' }, body: { p_rodada: String(envelope.rodada_id), p_contas: ids }, json: true, timeout: 30000 }) : [];
const brl = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d),)/g, '.');
const dias = (d, saldo) => Number(saldo) <= 0 ? ' · sem saldo' : d == null ? '' : Number(d) < 1 ? ' · acaba hoje' : ' · dura ~' + String(Number(d).toFixed(1)).replace('.', ',').replace(',0', '') + (Number(d) < 1.05 ? ' dia' : ' dias');
const data = new Date(envelope.concluido_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const linhas = (contas || []).map((c) => (c.dias != null && Number(c.dias) < 2 ? '🔴 ' : '🟡 ') + '*' + c.nome + '*' + (c.cliente && c.cliente !== c.nome ? ' (' + c.cliente + ')' : '') + '\nSaldo ' + brl(c.saldo) + ' · aviso abaixo de ' + brl(c.limite) + dias(c.dias, c.saldo) + '\nConta: ' + c.meta_id);
const mensagem = linhas.length ? '*💰 Saldo baixo nas contas de anúncio*\nAtualização: ' + data + '\n\n' + linhas.join('\n\n') + '\n\nLimites em Central LevelUp → Saldos.' : '';
return [{ json: { rodada_id: envelope.rodada_id, concluido_em: envelope.concluido_em, quantidade: linhas.length, contas, mensagem, status: linhas.length ? 'PRONTO_PARA_ENVIO' : 'SEM_CONTAS_ABAIXO_LIMITE', envio_habilitado: true, whatsapp_group_id: '120363415257706361@g.us', enviado: false } }];
