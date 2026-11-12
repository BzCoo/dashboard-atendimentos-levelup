-- public.atend_chegada(p_inicio, p_fim, p_conta, p_modo, p_de, p_ate, p_dias)
-- Leads pelo horário da 1ª mensagem do cliente (dash_atend.resp, horário local da loja), com faixa de minuto:
--   p_modo 'entre' (p_de..p_ate, pode passar da meia-noite; 00:00..24:00 = dia todo), 'depois' (>= p_de), 'antes' (< p_de), 'em' (hora de p_de)
--   p_dias 'todos' | 'uteis' | 'sab' | 'dom'
-- Devolve: total (dias filtrados), resumo da faixa, por_hora (24 horas com a parte na faixa), por_loja e leads (até 2000).
-- Aplicada pela migration dash_atend_horario_chegada; respeita dash_atend.contas_permitidas(p_conta).
-- Depois: atend_chegada virou embrulho com cache (dash_atend._atend_chegada faz o cálculo) e
-- public.atend_service_aquecer(p_fn) monta o cache da visão padrão dos admins; o n8n chama no fim de cada carga.
-- Depois: _atend_chegada devolve 'fonte' (opportunity_source do GHL; se vazia, rede do anúncio em ghl_lead_ad_attribution).

-- Filtro de fontes (aplicado direto no banco):
--   atend_chegada(..., p_fontes text[] DEFAULT NULL) e dash_atend._atend_chegada(..., p_fontes).
--   p_fontes = NULL traz todas; '' representa "Sem fonte". A chave do cache inclui as fontes.
--   A saída traz 'fontes' [{fonte, leads}], contada ANTES do filtro de fonte (alimenta as caixinhas do painel).

-- Modo 'corrido' (migração dash_atend_chegada_periodo_corrido): conta seguido de p_inicio + p_de até p_fim + p_ate
--   (ex.: 11/11 18:00 até 12/11 10:00), em vez de aplicar a faixa de horário dia a dia.
