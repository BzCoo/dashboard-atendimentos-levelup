// Um item por workflow do catálogo (para buscar as execuções de cada um)
const cat = $('Pegar catalogo e pedidos').first().json.automacoes || [];
const ids = [...new Set(cat.flatMap((a) => a.workflows || []))];
return ids.map((wf) => ({ json: { wf } }));
