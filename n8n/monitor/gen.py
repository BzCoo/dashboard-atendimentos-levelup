import json
J=lambda f: json.dumps(open(f).read())
C="{ n8nApi: { id: 'SCOeBSE08o04qLYk', name: 'n8n account' } }"
code=f"""import {{ workflow, node, trigger, ifElse, expr }} from '@n8n/workflow-sdk';
const agenda = trigger({{ type: 'n8n-nodes-base.scheduleTrigger', version: 1.3, config: {{ name: 'A cada 5 minutos', parameters: {{ rule: {{ interval: [{{ field: 'minutes', minutesInterval: 5 }}] }} }} }} }});
const pegar = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: 'Pegar catalogo e pedidos', parameters: {{ mode: 'runOnceForAllItems', jsCode: {J('pegar.js')} }} }} }});
const pedidos = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: 'Pedidos pendentes', parameters: {{ mode: 'runOnceForAllItems', jsCode: {J('pedidos.js')} }} }} }});
const ehLigar = ifElse({{ version: 2.2, config: {{ name: 'Ligar ou desligar', parameters: {{ conditions: {{ options: {{ caseSensitive: true, leftValue: '', typeValidation: 'strict' }}, conditions: [{{ leftValue: expr('{{{{ $json.acao }}}}'), operator: {{ type: 'string', operation: 'equals' }}, rightValue: 'ligar' }}], combinator: 'and' }} }} }} }});
const ligar = node({{ type: 'n8n-nodes-base.n8n', version: 1, config: {{ name: 'Ligar no n8n', onError: 'continueRegularOutput', parameters: {{ resource: 'workflow', operation: 'activate', workflowId: {{ __rl: true, mode: 'id', value: expr('{{{{ $json.workflow }}}}') }}, additionalFields: {{ versionId: expr('{{{{ $json.versao }}}}') }} }}, credentials: {C} }} }});
const desligar = node({{ type: 'n8n-nodes-base.n8n', version: 1, config: {{ name: 'Desligar no n8n', onError: 'continueRegularOutput', parameters: {{ resource: 'workflow', operation: 'deactivate', workflowId: {{ __rl: true, mode: 'id', value: expr('{{{{ $json.workflow }}}}') }} }}, credentials: {C} }} }});
const fimL = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: 'Registrar pedido (ligar)', parameters: {{ mode: 'runOnceForEachItem', jsCode: {J('fim_pedido.js')} }} }} }});
const fimD = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: 'Registrar pedido (desligar)', parameters: {{ mode: 'runOnceForEachItem', jsCode: {J('fim_pedido.js')} }} }} }});
const listar = node({{ type: 'n8n-nodes-base.n8n', version: 1, config: {{ name: 'Listar workflows', executeOnce: true, parameters: {{ resource: 'workflow', operation: 'getAll', returnAll: true, filters: {{ excludePinnedData: true }} }}, credentials: {C} }} }});
const wfs = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: 'Workflows do catalogo', executeOnce: true, parameters: {{ mode: 'runOnceForAllItems', jsCode: {J('wfs.js')} }} }} }});
const execs = node({{ type: 'n8n-nodes-base.n8n', version: 1, config: {{ name: 'Execucoes recentes', alwaysOutputData: true, onError: 'continueRegularOutput', parameters: {{ resource: 'execution', operation: 'getAll', returnAll: false, limit: 150, filters: {{ workflowId: {{ __rl: true, mode: 'id', value: expr('{{{{ $json.wf }}}}') }} }} }}, credentials: {C} }} }});
const falhas = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: 'Ultima falha de cada um', executeOnce: true, parameters: {{ mode: 'runOnceForAllItems', jsCode: {J('falhas.js')} }} }} }});
const detalhe = node({{ type: 'n8n-nodes-base.n8n', version: 1, config: {{ name: 'Detalhe da ultima falha', onError: 'continueRegularOutput', alwaysOutputData: true, parameters: {{ resource: 'execution', operation: 'get', executionId: expr('{{{{ $json.exec_id }}}}'), options: {{ activeWorkflows: true }} }}, credentials: {C} }} }});
const calc = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: 'Calcular saude e alertar', executeOnce: true, parameters: {{ mode: 'runOnceForAllItems', jsCode: {J('calcular.js')} }} }} }});
export default workflow('monitor-automacoes', 'DASH ATENDIMENTOS - Monitor de automacoes')
  .add(agenda).to(pegar).to(pedidos).to(ehLigar.onTrue(ligar.to(fimL)).onFalse(desligar.to(fimD)))
  .add(pegar).to(listar).to(wfs).to(execs).to(falhas).to(detalhe).to(calc);
"""
open('monitor.sdk.js','w').write(code)
print(len(code))
