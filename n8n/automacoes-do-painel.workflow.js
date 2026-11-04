import { workflow, node, trigger, sticky, switchCase, splitInBatches, nextBatch } from '@n8n/workflow-sdk';

const HDR = "const SB=String($env.SUPABASE_URL||'').replace(/\\/$/,''),SK=String($env.SUPABASE_SECRET_KEY||'');\n" +
  "if(!SB||!SK)throw new Error('Supabase nao configurado');\n" +
  "const call=async(fn,body,profile)=>{const h={apikey:SK,Authorization:'Bearer '+SK,'Content-Type':'application/json'};if(profile){h['Content-Profile']=profile;h['Accept-Profile']=profile;}let last;for(let i=0;i<3;i++){try{return await this.helpers.httpRequest({method:'POST',url:SB+'/rest/v1/rpc/'+fn,headers:h,body:body||{},json:true,timeout:60000});}catch(e){last=e;const s=Number(e.statusCode||e.response?.statusCode||0);if(s&&s<500&&s!==408&&s!==429)break;await new Promise(r=>setTimeout(r,1500*(i+1)));}}throw last;};\n" +
  "const msg=e=>String(e?.response?.body?.message||e?.description||e?.message||e||'erro').slice(0,500);\n";

const PEGAR = HDR + `
// 1) Proxima automacao da fila (uma por vez). Nada na fila: encerra sem fazer nada.
const ex=await call('atend_service_auto_pegar',{p_n8n:String($execution.id)});
if(!ex||!ex.id)return [];
const p=ex.params||{},sim=ex.simulacao===true,itens=Array.isArray(ex.itens)?ex.itens:[];
const base={_exec:ex.id,_tipo:ex.tipo,_sim:sim};
// Pipeline: mesma trava da automacao agendada, para nao rodarem juntas
if(ex.tipo==='pipeline'){
  const lk=await call('try_claim_automation_lock',{p_lock_name:'pipeline-global',p_owner_id:'painel:'+ex.id,p_ttl_seconds:7200},'metrics_dev');
  const row=Array.isArray(lk)?lk[0]:lk;
  if(!row||row.acquired!==true){await call('atend_service_auto_fim',{p_id:ex.id,p_erro:'O Pipeline Inteligente agendado esta rodando agora. Tente de novo em alguns minutos.'});return [];}
}
let contasPipeline=new Map();
if(ex.tipo==='pipeline'){
  const rows=await call('get_ghl_pipeline_accounts_v2',{},'metrics_dev');
  contasPipeline=new Map((Array.isArray(rows)?rows:[]).map(({ghl_api_token,...r})=>[Number(r.account_id),r]));
}
const out=[];
for(const it of itens){
  const b={...base,_item:it.id,_rotulo:it.rotulo,_loja:it.loja_id};
  if(ex.tipo==='recarregar')out.push({...b,'ID da subconta no banco de dados':it.loja_id,'In\\u00edcio':p.inicio,'Fim':p.fim});
  else if(ex.tipo==='pipeline'){
    const c=contasPipeline.get(Number(it.loja_id));
    if(!c||c.configuration_ready!==true){await call('atend_service_auto_item',{p_item:it.id,p_status:'ignorado',p_erro:'Pipeline Inteligente nao configurado para esta conta (etapas ou regras faltando)'});continue;}
    out.push({...c,...b,dry_run:sim,janela_dias:p.janela_dias||30,reanalisar:p.reanalisar===true,pipeline_max_leads_per_run:p.max_leads||100});
  }
  else if(ex.tipo==='aguardando')out.push({...b,accountId:it.loja_id,windowMin:(Number(p.janela_horas)||24)*60,dryRun:sim,prefetchWaiting:true});
  else if(ex.tipo==='etapas')out.push({...b,conta:{id:it.loja_id,location_id:it.location_id,pipeline_id:it.pipeline_id}});
  else if(ex.tipo==='anuncio_origem')out.push({...b,painel:true,simulacao:sim,max_leads:p.max_leads||100,conta:it.loja_id});
  else if(ex.tipo==='relatorio_ia')out.push({...b,account_id:it.loja_id,inicio:p.inicio,fim:p.fim,enviar:p.enviar===true});
  else await call('atend_service_auto_item',{p_item:it.id,p_status:'falhou',p_erro:'Automacao desconhecida'});
}
// Todas as contas ignoradas: fecha a execucao aqui mesmo
if(!out.length){await call('atend_service_auto_fim',{p_id:ex.id});if(ex.tipo==='pipeline')await call('release_automation_lock',{p_lock_name:'pipeline-global',p_owner_id:'painel:'+ex.id},'metrics_dev').catch(()=>{});return [];}
return out.map(json=>({json}));`;

const INICIO = HDR + `
// 2) Marca a conta como em andamento; se o ADM cancelou, pula as que faltam
const it=$input.first().json;
const r=await call('atend_service_auto_item',{p_item:it._item,p_status:'executando'});
if(r&&r.cancelar===true){await call('atend_service_auto_item',{p_item:it._item,p_status:'cancelado'});return [{json:{...it,_tipo:'pular'}}];}
return [{json:it}];`;

const ETAPAS = HDR + `
// Sincroniza nomes e ordem das etapas de uma conta (mesma logica da fila do painel)
const it=$input.first().json,c=it.conta||{};
try{
  const token=await call('get_ghl_account_token',{p_account_id:Number(c.id)},'metrics_dev');
  if(typeof token!=='string'||!token)throw new Error('token do CRM ausente');
  const p=await this.helpers.httpRequest({method:'GET',url:'https://services.leadconnectorhq.com/opportunities/pipelines',qs:{locationId:c.location_id},headers:{Authorization:'Bearer '+token,Version:'2021-07-28',Accept:'application/json'},json:true,timeout:30000});
  const pipe=(p.pipelines||[]).find(x=>x.id===c.pipeline_id);
  if(!pipe)throw new Error('pipeline principal nao encontrado no CRM');
  const etapas=(pipe.stages||[]).map(st=>({id:st.id,name:st.name,position:st.position}));
  const n=await call('atend_service_salvar_etapas',{p_loja:Number(c.id),p_etapas:etapas});
  return [{json:{etapas:etapas.length,salvas:Number(n)||0,nomes:etapas.map(e=>e.name)}}];
}catch(e){return [{json:{error:{message:msg(e)}}}];}`;

const FIM_ITEM = HDR + `
// 3) Traduz o resultado de cada automacao para o relatorio do painel e grava
const it=$('Inicio do item').first().json;
if(it._tipo==='pular')return [{json:{ok:true}}];
const rows=$input.all().map(i=>i.json||{});const r=rows[0]||{};
const errOf=x=>{const e=x&&x.error;if(!e)return null;return String(typeof e==='string'?e:(e.message||e.description||JSON.stringify(e))).slice(0,600);};
let status='ok',resultado=null,erro=errOf(r);
const vazio=!rows.length||Object.keys(r).length===0;
if(erro){status='falhou';}
else if(it._tipo==='recarregar'){
  resultado={leads:Number(r.leadsAndAttendances)||0,mensagens:Number(r.messages)||0,vendedores:Number(r.registeredUsers)||0};
}else if(it._tipo==='pipeline'){
  if(vazio){status='falhou';erro='O Pipeline nao devolveu resultado';}
  else resultado={simulacao:it._sim,analisados:Number(r.analyzed_count)||0,selecionados:Number(r.selected_count)||0,movidos:Number(r.movidos)||0,moveria:Number(r.moveria)||0,revisao_humana:Number(r.revisao_humana)||0,sem_conversa:Number(r.sem_conversa)||0,fora_de_etapa:Number(r.fora_de_etapa)||0,reconciliados:Number(r.reconciliados)||0,detalhes:Array.isArray(r.detalhes)?r.detalhes.slice(0,300):[]};
  if(r.worker_status==='failed'){status='falhou';erro=r.worker_error||'O Pipeline falhou';}
}else if(it._tipo==='aguardando'){
  if(vazio){status='ignorado';erro='A automacao de atendimento nao esta ligada nesta conta';}
  else{
    const errs=(r.errors||[]).map(String),dry=errs.filter(e=>e.startsWith('DRY')),reais=errs.filter(e=>!e.startsWith('DRY'));
    if(reais.length&&!Number(r.moved)&&!Number(r.waiting)){status='falhou';erro=reais[0]==='etapas nao encontradas'?'Etapas Aguardando/Atendimento nao encontradas no pipeline desta conta':reais[0];}
    resultado={simulacao:it._sim,conversas:Number(r.conversations)||0,em_aguardando:Number(r.waiting)||0,movidos:it._sim?0:Number(r.moved)||0,moveria:it._sim?Number(r.moved)||0:0,falhas:Number(r.failed)||0,exemplos:dry.slice(0,30).map(e=>e.replace(/^DRY /,'')),avisos:reais.slice(0,5)};
  }
}else if(it._tipo==='etapas'){
  resultado={etapas:Number(r.etapas)||0,nomes:r.nomes||[]};
}else if(it._tipo==='anuncio_origem'){
  const d=(r.detalhe||[])[0]||{};
  resultado={simulacao:it._sim,pendentes:Number(r.leadsProcessados)||0,contatos:Number(r.contatosGravados||r.contatosAGravar)||0,oportunidades:Number(r.oportunidadesGravadas||r.oportunidadesAGravar)||0,falhas:Number(r.falhasDeLead)||0,campos_criados:d.camposCriados||[],campos_ausentes:d.camposAusentes||[]};
  if(vazio||!Number(r.subcontas)){resultado={simulacao:it._sim,pendentes:0,nada:true};}
  if(d.erro){status=Number(r.leadsProcessados)?'ok':'falhou';erro=String(d.erro).slice(0,500);}
}else if(it._tipo==='relatorio_ia'){
  if(vazio||!r.report){status='falhou';erro=erro||'A IA nao devolveu o relatorio';}
  else resultado={enviado:r.status==='enviado',texto:String(r.report).slice(0,8000)};
}
await call('atend_service_auto_item',{p_item:it._item,p_status:status,p_resultado:resultado,p_erro:erro});
return [{json:{item:it._item,status}}];`;

const FIM_EXEC = HDR + `
// 4) Fecha a execucao e libera a trava do pipeline
const it=$('Pegar automacao da fila').first().json;
await call('atend_service_auto_fim',{p_id:it._exec});
if(it._tipo==='pipeline'){try{await call('release_automation_lock',{p_lock_name:'pipeline-global',p_owner_id:'painel:'+it._exec},'metrics_dev');}catch(e){}}
return [{json:{execucao:it._exec,concluida:true}}];`;

const subwf = (name, id, cached, pos) => node({
  type: 'n8n-nodes-base.executeWorkflow', version: 1.3,
  config: {
    name, position: pos, alwaysOutputData: true, onError: 'continueRegularOutput',
    parameters: {
      source: 'database',
      workflowId: { __rl: true, value: id, mode: 'list', cachedResultName: cached },
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      mode: 'once',
      options: { waitForSubWorkflow: true },
    },
  },
  output: [{}],
});

const cada = trigger({ type: 'n8n-nodes-base.scheduleTrigger', version: 1.3, config: { name: 'A cada minuto', position: [0, 300], parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } } }, output: [{}] });
const pegar = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Pegar automacao da fila', position: [220, 300], parameters: { mode: 'runOnceForAllItems', jsCode: PEGAR } }, output: [{ _exec: 1, _item: 1, _tipo: 'etapas' }] });
const loop = splitInBatches({ version: 3, config: { name: 'Uma conta por vez', position: [440, 300], parameters: { batchSize: 1, options: {} } } });
const inicio = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Inicio do item', position: [660, 400], parameters: { mode: 'runOnceForAllItems', jsCode: INICIO } }, output: [{ _exec: 1, _item: 1, _tipo: 'etapas' }] });
const regra = (k) => ({ outputKey: k, conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: '={{ $json._tipo }}', operator: { type: 'string', operation: 'equals' }, rightValue: k }], combinator: 'and' } });
const rotear = switchCase({ version: 3.2, config: { name: 'Qual automacao', position: [880, 400], parameters: { rules: { values: ['recarregar', 'pipeline', 'aguardando', 'etapas', 'anuncio_origem', 'relatorio_ia'].map(regra) }, options: { fallbackOutput: 'extra', renameFallbackOutput: 'Pular' } } } });
const wRec = subwf('Recarregar dados do GHL', 'q2xze0oqTB34j7gA', 'ATUALIZAÇÃO MANUAL DO BANCO — SUBCONTA E PERÍODO', [1140, 100]);
const wPipe = subwf('Pipeline Inteligente', '90b4YwHPz1fL8Rps', 'GERAL - Worker Pipeline Inteligente - Uma Subconta', [1140, 250]);
const wAg = subwf('Aguardando para Atendimento', '47FfxDLNq71ZBH1d', 'GERAL - Varredura Aguardando -> Atendimento', [1140, 400]);
const etapas = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Sincronizar etapas', position: [1140, 550], parameters: { mode: 'runOnceForAllItems', jsCode: ETAPAS } }, output: [{ etapas: 10 }] });
const wOrig = subwf('Gravar anuncio de origem', 'kZ0Gs5bv6HrGpFyX', 'GERAL - Anúncio de Origem no GHL - Subcontas Piloto', [1140, 700]);
const wRel = subwf('Relatorio com IA', 'f3v3EZnXRnCGIPky', 'Relatório Específico', [1140, 850]);
const fimItem = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Registrar resultado da conta', position: [1420, 400], parameters: { mode: 'runOnceForAllItems', jsCode: FIM_ITEM } }, output: [{ item: 1, status: 'ok' }] });
const fimExec = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Fechar execucao', position: [660, 120], executeOnce: true, parameters: { mode: 'runOnceForAllItems', jsCode: FIM_EXEC } }, output: [{ concluida: true }] });

const nota = sticky('## Automações do Dashboard de Atendimentos\nO ADM pede a automação na aba **Automações** do painel (dash_atend.auto_execucoes). A cada minuto este fluxo pega a próxima da fila (uma por vez), roda conta por conta chamando o fluxo de cada automação e grava o andamento e o resultado em dash_atend.auto_itens. O painel mostra a barra de progresso, o tempo estimado e o relatório final.\n\nSimulação: Pipeline, Aguardando e Anúncio de origem recebem a flag e não alteram o CRM nem o banco.', [cada, pegar, loop], { color: 4, width: 760, height: 220 });

export default workflow('automacoes-painel', 'DASH ATENDIMENTOS - Automações do painel')
  .add(cada)
  .to(pegar)
  .to(loop
    .onDone(fimExec)
    .onEachBatch(inicio.to(rotear
      .onCase(0, wRec.to(fimItem))
      .onCase(1, wPipe.to(fimItem))
      .onCase(2, wAg.to(fimItem))
      .onCase(3, etapas.to(fimItem))
      .onCase(4, wOrig.to(fimItem))
      .onCase(5, wRel.to(fimItem))
      .onCase(6, fimItem))))
  .add(fimItem)
  .to(nextBatch(loop))
  .add(nota);
