// Bot Interno Velotax - Assistente Especializado
// Sistema de autenticação gerenciado pelo auth.js

// ================== EXEMPLO DE USO COMPLETO ==================
/*
<!DOCTYPE html>
<html>
<head>
    <script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body>
    <div id="login-overlay">
        <button id="google-signin-button">Entrar com Google</button>
    </div>
    
    <div id="app" class="hidden">
        <h1>Bem-vindo!</h1>
        <button id="logout-button">Sair</button>
    </div>
    
    <script>
        // Cole todo o código JavaScript aqui
    </script>
</body>
</html>
*/

// ================== FIM DO SCRIPT SSO GOOGLE ==================

// ================== CONFIGURAÇÕES DA EMPRESA ==================
const NOME_EMPRESA = 'Velotax';
const DOMINIO_CORPORATIVO = '@velotax.com.br';
const SITE_EMPRESA = 'https://www.velotax.com.br';

// Atualiza o card de Estatísticas (janela móvel de confiabilidade, vinda da planilha)
async function carregarEstatisticasGlobais() {
    await atualizarEstatisticasNaInterface();
}

// Atualizar estatísticas na interface (janela móvel dos últimos N dias - mesma janela da auditoria)
async function atualizarEstatisticasNaInterface() {
    console.log('🔄 Atualizando interface com estatísticas do dia');
    
    try {
        const response = await fetch('/api/estatisticas-hoje');
        const data = await response.json();
        
        if (data.success) {
            const stats = {
                respostas_coerentes: data.respostas_coerentes ?? 0,
                moderacoes_coerentes: data.moderacoes_coerentes ?? 0,
                moderacoes_aprovadas: data.moderacoes_aprovadas ?? 0,
                moderacoes_negadas: data.moderacoes_negadas ?? 0,
                moderacoes_pendentes: data.moderacoes_pendentes ?? 0
            };
            document.querySelectorAll('.stat-value[data-stat]').forEach(el => {
                const key = el.getAttribute('data-stat');
                if (stats[key] !== undefined) el.textContent = stats[key];
            });
            const elPendentes = document.getElementById('badge-moderacoes-pendentes');
            if (elPendentes) {
                elPendentes.classList.toggle('d-none', !stats.moderacoes_pendentes);
                elPendentes.textContent = stats.moderacoes_pendentes;
            }
            const elUpdated = document.getElementById('estatisticas-last-updated');
            if (elUpdated) elUpdated.textContent = `Últimos ${data.janelaDias ?? 90} dias · Atualizado: ${data.lastUpdated || '—'}`;
            console.log('✅ Estatísticas (janela):', data.janelaDias, stats);
            console.log('📅 Última atualização:', data.lastUpdated || '—');
        } else {
            console.warn('⚠️ Resposta estatísticas-hoje sem success');
            zerarEstatisticasNaInterface();
        }
    } catch (error) {
        console.error('❌ Erro ao buscar estatísticas do dia:', error);
        zerarEstatisticasNaInterface();
    }
}

function zerarEstatisticasNaInterface() {
    document.querySelectorAll('.stat-value[data-stat]').forEach(el => el.textContent = '0');
    const elUpdated = document.getElementById('estatisticas-last-updated');
    if (elUpdated) elUpdated.textContent = '—';
    
    // Histórico removido - funcionalidade obsoleta
}

// Histórico de respostas
let historicoRespostas = [];

// Rascunhos salvos
let rascunhos = [];

// Prompt mestre para IA OpenAI
const PROMPT_MASTER_OPENAI = `Você é o assistente especializado da ${NOME_EMPRESA} para comunicação com clientes e moderação no Reclame Aqui. Sua função é gerar respostas completas, claras e no tom correto com base nos dados recebidos da aba "Respostas RA".

### Regras para formulação de respostas:
1. **Respostas Reclame Aqui**
   - Tom formal, técnico, cordial e imparcial
   - Estruture em parágrafos curtos, objetivos e claros
   - Cite LGPD, CCB ou CDC somente se constarem na solução implementada ou forem indispensáveis ao relato do que foi feito
   - Explique chave Pix, exclusão de cadastro e demais pontos conforme a solução implementada e os dados do caso, sem fundamentação extra
   - Para atrasos de crédito, cite prazos oficiais (ex.: Banco do Brasil: até o próximo dia útil)

2. **E-mails para clientes**
   - Tom próximo, amigável e encorajador
   - Explique próximos passos de forma simples

3. **Textos de moderação (RA)**
   - Seguir rigorosamente os manuais oficiais do RA
   - Justificar decisões de forma objetiva e formal
   - Evitar qualquer tom emocional ou subjetivo

4. **Confirmações ou avisos internos**
   - Texto curto, informativo e direto

### Instrução final:
Com base nos dados fornecidos, formule o texto final pronto para envio ou publicação no formato correspondente ao tipo de solicitação.
- Não inclua rótulos extras
- Entregue apenas o conteúdo já formatado
- Garanta coerência, clareza e alinhamento com padrões da ${NOME_EMPRESA}`;


// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    initializeBot();
    setupEventListeners();
    inicializarHistorico();
    inicializarRelatorioReclamacoesUI();
    
    // Verificar dados do localStorage ao carregar a página
    setTimeout(() => {
        sincronizarDadosLocais();
    }, 2000);
});

// Inicialização do bot
function initializeBot() {
    console.log(`Bot Interno ${NOME_EMPRESA} - Assistente Especializado inicializado`);
    console.log('🔧 Testando funções básicas...');
    
    // Teste básico
    try {
        console.log('✅ JavaScript funcionando');
        console.log('✅ Funções carregadas:', {
            gerarRespostaOpenAI: typeof gerarRespostaOpenAI,
            avaliarResposta: typeof avaliarResposta,
            avaliarModeracao: typeof avaliarModeracao
        });
    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
    }
    
    showSuccessMessage('Bot conectado e pronto para uso!');
}

// Configuração dos event listeners
function setupEventListeners() {
    // Navegação entre ferramentas
    document.querySelectorAll('[data-tool]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const tool = this.getAttribute('data-tool');
            switchTool(tool);
        });
    });
}

// Troca entre ferramentas
function switchTool(toolName) {
    // Remove active de todos os links e painéis
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    document.querySelectorAll('.tool-panel').forEach(panel => panel.classList.remove('active'));
    
    // Adiciona active ao link e painel selecionado
    document.querySelector(`[data-tool="${toolName}"]`).classList.add('active');
    document.getElementById(`${toolName}-tool`).classList.add('active');

    // Carrega a auditoria sob demanda na primeira abertura da aba
    if (toolName === 'auditoria' && !window._auditoriaCarregada) {
        carregarAuditoria();
    }
}

// ===== FUNÇÕES DO RECLAME AQUI COM IA OPENAI =====

async function gerarRespostaOpenAI() {
    console.log('🚀 Função gerarRespostaOpenAI chamada');
    console.log('🔍 Verificando elementos do DOM...');
    
    const tipoSituacao = document.getElementById('tipo-situacao');
    const idReclamacao = document.getElementById('id-reclamacao');
    const reclamacao = document.getElementById('reclamacao-text');
    const solucao = document.getElementById('solucao-implementada');
    const historico = document.getElementById('historico-atendimento');
    const nomeSolicitanteEl = document.getElementById('nome-solicitante');
    
    console.log('🔍 Elementos encontrados:', {
        tipoSituacao: tipoSituacao ? 'OK' : 'NÃO ENCONTRADO',
        idReclamacao: idReclamacao ? 'OK' : 'NÃO ENCONTRADO',
        reclamacao: reclamacao ? 'OK' : 'NÃO ENCONTRADO',
        solucao: solucao ? 'OK' : 'NÃO ENCONTRADO',
        historico: historico ? 'OK' : 'NÃO ENCONTRADO',
        nomeSolicitante: nomeSolicitanteEl ? 'OK' : 'NÃO ENCONTRADO'
    });
    
    if (!tipoSituacao || !idReclamacao || !reclamacao) {
        console.error('❌ Elementos obrigatórios não encontrados!');
        showErrorMessage('Erro: Elementos do formulário não encontrados. Verifique se a página carregou corretamente.');
        return;
    }
    
    const tipoSituacaoValue = tipoSituacao.value;
    const idReclamacaoValue = idReclamacao.value.trim();
    const reclamacaoValue = reclamacao.value;
    const solucaoValue = solucao ? solucao.value : '';
    const historicoValue = historico ? historico.value : '';
    const nomeSolicitanteValue = nomeSolicitanteEl ? nomeSolicitanteEl.value.trim() : '';
    
    console.log('Dados coletados:', {
        tipoSituacao: tipoSituacaoValue,
        idReclamacao: idReclamacaoValue,
        reclamacao: reclamacaoValue.substring(0, 50) + '...',
        solucao: solucaoValue.substring(0, 50) + '...'
    });
    
    // Validação dos campos obrigatórios (Solução Implementada e Nome do solicitante deixaram de ser obrigatórios)
    if (!tipoSituacaoValue || !idReclamacaoValue || !reclamacaoValue || (typeof reclamacaoValue === 'string' && !reclamacaoValue.trim())) {
        console.log('Validação falhou - campos obrigatórios não preenchidos');
        showErrorMessage('Por favor, preencha os campos obrigatórios (*): Tipo de Situação, ID da Reclamação e Reclamação do Cliente.');
        return;
    }
    
    console.log('Validação passou - iniciando geração de resposta');
    
    // Mostrar loading
    showLoadingMessage('Gerando resposta com IA OpenAI...');
    
    try {
        console.log('Preparando dados para IA OpenAI');
        
        // Preparar dados para envio ao servidor
        const dadosResposta = {
            tipo_solicitacao: tipoSituacaoValue,
            id_reclamacao: idReclamacaoValue,
            texto_cliente: reclamacaoValue,
            solucao_implementada: solucaoValue,
            historico_atendimento: historicoValue,
            nome_solicitante: nomeSolicitanteValue,
            timestamp: new Date().toISOString()
        };
        
        console.log('Chamando servidor...');
        
        // Chamar servidor para gerar resposta
        const apiResult = await gerarRespostaRAViaAPI(dadosResposta);
        const resposta = apiResult.result;
        
        console.log('Resposta recebida:', resposta.substring(0, 100) + '...');
        
        // Exibir resposta
        document.getElementById('texto-resposta-gpt5').value = resposta;
        document.getElementById('resposta-gpt5').style.display = 'block';

        showSuccessMessage('Resposta gerada com sucesso pela IA OpenAI!');

        // Chance de Moderação automática na própria aba Reclame Aqui
        if (apiResult.chanceModeracao?.success && apiResult.chanceModeracao.result) {
            await aplicarChanceModeracaoPosRespostaRA({
                reclamacaoCompleta: reclamacaoValue,
                respostaPublica: resposta,
                ...apiResult.chanceModeracao,
                origem: 'pev',
                executionId: apiResult.executionId || null
            });
        } else {
            await aplicarChanceModeracaoPosRespostaRA({
                reclamacaoCompleta: reclamacaoValue,
                respostaPublica: resposta,
                origem: 'ra-auto'
            });
        }
        
        console.log('Resposta exibida na interface');
        
        // Salvar no histórico
        const itemHistorico = {
            id: Date.now(),
            dados: dadosResposta,
            resposta: resposta,
            status: 'gerada',
            timestamp: new Date().toISOString(),
            chanceModeracao: apiResult.chanceModeracao || null
        };
        historicoRespostas.unshift(itemHistorico);
    
    // Recarregar estatísticas globais do servidor
    carregarEstatisticasGlobais();
    
    } catch (error) {
        console.error('Erro ao gerar resposta:', error);
        
        // Mostrar mensagem de erro mais específica se disponível
        let errorMsg = 'Erro ao gerar resposta.';
        if (error.message) {
            // Se a mensagem contém detalhes, mostrar apenas a primeira linha (erro principal)
            const errorLines = error.message.split('\n');
            errorMsg = errorLines[0];
            
            // Se houver detalhes, logar no console
            if (errorLines.length > 1) {
                console.error('Detalhes do erro:', errorLines.slice(1).join('\n'));
            }
        }
        
        showErrorMessage(errorMsg);
    }
}

// Função para chamar o endpoint do servidor para gerar resposta RA
async function gerarRespostaRAViaAPI(dadosResposta) {
    try {
        console.log('📡 Enviando dados para o servidor...');
        
        // Obter dados do usuário autenticado
        const userData = window.auth?.dadosUsuario ? {
            nome: window.auth.dadosUsuario().nome,
            email: window.auth.dadosUsuario().email,
            funcao: window.auth.dadosUsuario().funcao,
            departamento: window.auth.dadosUsuario().departamento,
            genero: window.auth.dadosUsuario().genero
        } : null;
        
        console.log('👤 Dados do usuário para geração:', userData);
        
        const response = await fetch('/api/gerar-resposta', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                dadosFormulario: dadosResposta,
                userData: userData
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Resposta gerada com sucesso pelo servidor');
            return {
                result: data.result,
                pipeline: data.pipeline || null,
                executionId: data.executionId || null,
                usedFallback: data.usedFallback,
                chanceModeracao: data.chanceModeracao || null
            };
        } else {
            // Log detalhado do erro
            console.error('❌ Erro do servidor:', {
                error: data.error,
                details: data.details,
                statusCode: data.statusCode
            });
            
            // Criar mensagem de erro mais detalhada
            let errorMessage = data.error || 'Erro desconhecido do servidor';
            if (data.details) {
                errorMessage += `\n\nDetalhes: ${data.details}`;
            }
            
            throw new Error(errorMessage);
        }
        
    } catch (error) {
        console.error('❌ Erro na comunicação com o servidor:', error);
        throw error;
    }
}

async function chamarOpenAI(dados) {
    console.log('chamarOpenAI iniciada com dados:', dados.tipo_solicitacao);
    
    // Chamada real para API OpenAI via servidor
    
    const prompt = `${PROMPT_MASTER_OPENAI}

### Dados recebidos:
- Tipo de solicitação: ${dados.tipo_solicitacao}
- ID da Reclamação: ${dados.id_reclamacao}
- Reclamação do cliente: ${dados.texto_cliente}
- Solução implementada: ${dados.solucao_implementada}
- Histórico de atendimento: ${dados.historico_atendimento || 'Nenhum'}
- Nome do solicitante: ${dados.nome_solicitante || 'N/A'}

Gere a resposta apropriada:`;

    console.log('Prompt preparado, simulando delay da API...');
    
    // Simular delay da API
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('Delay concluído, gerando resposta simulada...');
    
    // Resposta simulada baseada no tipo de situação
    const resposta = gerarRespostaSimulada(dados);
    
    console.log('Resposta simulada gerada:', resposta.substring(0, 50) + '...');
    
    return resposta;
}

function gerarRespostaSimulada(dados) {
    let resposta = '';
    
    // Saudação
    resposta += 'Prezado(a) cliente,\n\n';
    
    // Conteúdo baseado no tipo de situação
    switch (dados.tipo_solicitacao) {
        case 'exclusao-chave-pix-cpf':
            resposta += 'Informamos que sua solicitação de exclusão de chave Pix CPF foi processada conforme solicitado.\n\n';
            resposta += 'O prazo para processamento é de até 2 dias úteis, conforme regulamentação do Banco Central do Brasil.\n\n';
            break;
        case 'exclusao-cadastro':
            resposta += 'Sua solicitação de exclusão de cadastro foi devidamente registrada em nossos sistemas.\n\n';
            resposta += 'A exclusão será realizada em até 15 dias úteis, conforme previsto na Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018).\n\n';
            break;
        case 'pagamento-restituicao':
            resposta += 'O pagamento de sua restituição foi processado conforme solicitado.\n\n';
            resposta += 'O valor será creditado em sua conta em até 3 dias úteis, conforme prazo estabelecido.\n\n';
            break;
        case 'juros-abusivos':
            resposta += 'Informamos que todos os juros aplicados estão em conformidade com a legislação vigente e as cláusulas contratuais estabelecidas.\n\n';
            resposta += 'Nossos cálculos seguem rigorosamente as diretrizes do Banco Central do Brasil.\n\n';
            break;
        case 'demora-resolucao':
            resposta += 'Lamentamos pelo tempo decorrido na resolução de sua solicitação.\n\n';
            resposta += 'Nossa equipe está trabalhando para acelerar o processo e resolver sua situação o mais breve possível.\n\n';
            break;
        default:
            resposta += 'Sua solicitação foi devidamente registrada em nossos sistemas.\n\n';
            resposta += 'Nossa equipe está analisando o caso e entrará em contato em breve.\n\n';
    }
    
    // Adicionar solução implementada
    if (dados.solucao_implementada) {
        resposta += dados.solucao_implementada + '\n\n';
    }
    
    // Adicionar histórico se houver
    if (dados.historico_atendimento) {
        resposta += 'Conforme já havíamos encaminhado anteriormente, ' + dados.historico_atendimento.toLowerCase() + '.\n\n';
    }
    
    // Fechamento padrão
    resposta += 'Seguimos à disposição para ajudar.\n\n';
    
    return resposta.trim();
}

// ===== FUNÇÕES DE AVALIAÇÃO E REFORMULAÇÃO =====

// Busca registros já salvos (respostas ou moderações) pra um ID da Reclamação — usado antes de
// salvar como coerente, pra avisar o agente se esse ID já tem algo registrado (double-click,
// esquecimento de que já fez esse atendimento etc). Best-effort: se a checagem falhar (rede,
// timeout), não bloqueia o fluxo — melhor deixar salvar do que travar o agente por causa disso.
async function buscarRegistrosExistentesPorId(idReclamacao, tipo) {
    try {
        const response = await fetch(`/api/solicitacoes?idReclamacao=${encodeURIComponent(idReclamacao)}&tipo=${tipo}`);
        const data = await response.json();
        return (data.success && Array.isArray(data.solicitacoes)) ? data.solicitacoes : [];
    } catch (error) {
        console.warn('⚠️ Não foi possível checar duplicidade antes de salvar (seguindo sem checar):', error.message);
        return [];
    }
}

// Confirma com o agente antes de salvar como coerente um ID que já tem registro(s) anteriores.
// Retorna true = pode salvar (não havia duplicidade, ou o agente confirmou mesmo assim).
async function confirmarSalvarComDuplicidade(idReclamacao, tipo, rotuloTipo) {
    if (!idReclamacao) return true;
    const existentes = await buscarRegistrosExistentesPorId(idReclamacao, tipo);
    if (existentes.length === 0) return true;

    const maisRecente = existentes[existentes.length - 1];
    const statusMaisRecente = maisRecente.resultadoModeracao || maisRecente.status || 'sem resultado registrado ainda';
    const mensagem = `⚠️ Essa reclamação (ID ${idReclamacao}) já tem ${existentes.length === 1 ? `${rotuloTipo} salva` : `${existentes.length} ${rotuloTipo}s salvas`} anteriormente — a mais recente em ${maisRecente.data || 'data desconhecida'} (${statusMaisRecente}).\n\nSe você já atendeu esse caso antes (ou clicou 2x sem querer), cancele. Só confirme se for realmente intencional salvar de novo.`;
    return confirm(mensagem);
}

async function avaliarResposta(tipoAvaliacao) {
    console.log('🎯 Função avaliarResposta chamada com tipo:', tipoAvaliacao);
    
    const respostaAtual = document.getElementById('texto-resposta-gpt5').value;
    
    console.log('📝 Resposta atual capturada:', respostaAtual ? 'OK' : 'VAZIO');
    
    if (!respostaAtual || (typeof respostaAtual === 'string' && !respostaAtual.trim())) {
        console.log('❌ Resposta vazia, mostrando erro');
        showErrorMessage('Não há resposta para avaliar.');
        return;
    }
    
    // Obter dados atuais do formulário
    const dadosAtuais = {
        tipo_solicitacao: document.getElementById('tipo-situacao').value,
        id_reclamacao: document.getElementById('id-reclamacao').value.trim(),
        texto_cliente: document.getElementById('reclamacao-text').value,
        solucao_implementada: document.getElementById('solucao-implementada')?.value || '',
        historico_atendimento: document.getElementById('historico-atendimento')?.value || '',
        nome_solicitante: document.getElementById('nome-solicitante')?.value.trim() || '',
        timestamp: new Date().toISOString()
    };
    
    if (tipoAvaliacao === 'coerente') {
        console.log('✅ Marcando como coerente - iniciando salvamento');

        // Respostas não têm um fluxo de "reformulação vinculada" (isso só existe pra moderação),
        // então qualquer ID que já tenha resposta salva é candidato a duplicidade acidental.
        const podeSalvar = await confirmarSalvarComDuplicidade(dadosAtuais.id_reclamacao, 'respostas', 'resposta');
        if (!podeSalvar) {
            showErrorMessage('Salvamento cancelado.');
            return;
        }

        // Marcar como aprovada
        const itemAtual = historicoRespostas[0];
        if (itemAtual) {
            itemAtual.status = 'aprovada';
            itemAtual.resposta_aprovada = respostaAtual;
            console.log('📝 Item atual marcado como aprovado');
        } else {
            console.log('⚠️ Nenhum item atual encontrado no histórico');
        }
        
        // Salvar como modelo para futuras solicitações similares
        console.log('🚀 Chamando salvarRespostaComoModelo...');
        
        // Verificar se houve feedback anterior para incluir no aprendizado
        const itemComFeedback = historicoRespostas.find(item => 
            item.feedback && item.status === 'reformulada_com_feedback'
        );
        
        if (itemComFeedback) {
            console.log('🧠 Incluindo feedback anterior no aprendizado...');
            dadosAtuais.feedback_anterior = itemComFeedback.feedback;
            dadosAtuais.resposta_anterior = itemComFeedback.resposta_anterior;
        }
        
        await salvarRespostaComoModelo(dadosAtuais, respostaAtual);
        
        // Atualizar estatísticas globais após salvar
        carregarEstatisticasGlobais();
        
    } else if (tipoAvaliacao === 'reformular') {
        // Solicitar feedback do usuário para aprendizado
        solicitarFeedbackParaReformulacao(dadosAtuais, respostaAtual);
    }
}

// Função para salvar resposta como modelo quando marcada como coerente
async function salvarRespostaComoModelo(dadosAtuais, respostaAprovada) {
    try {
        console.log('🚀 FUNÇÃO salvarRespostaComoModelo INICIADA!');
        console.log('💾 Salvando resposta como modelo:', dadosAtuais.tipo_solicitacao);
        console.log('📝 Dados capturados:', {
            tipo_solicitacao: dadosAtuais.tipo_solicitacao,
            motivo_solicitacao: dadosAtuais.motivo_solicitacao,
            resposta_length: respostaAprovada ? respostaAprovada.length : 0
        });
        
        // 1. Salvar no localStorage como backup
        console.log('💾 Salvando no localStorage como backup...');
        const modeloLocal = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            tipo_situacao: dadosAtuais.tipo_solicitacao,
            id_reclamacao: dadosAtuais.id_reclamacao,
            dadosFormulario: dadosAtuais,
            respostaAprovada: respostaAprovada,
            contexto: {
                tipoSituacao: dadosAtuais.tipo_solicitacao,
                idReclamacao: dadosAtuais.id_reclamacao
            }
        };
        
        // Carregar modelos existentes do localStorage
        const modelosExistentes = JSON.parse(localStorage.getItem('modelos_respostas_coerentes') || '[]');
        modelosExistentes.unshift(modeloLocal); // Adicionar no início
        
        // Manter apenas os últimos 50 modelos no localStorage
        if (modelosExistentes.length > 50) {
            modelosExistentes.splice(50);
        }
        
        localStorage.setItem('modelos_respostas_coerentes', JSON.stringify(modelosExistentes));
        console.log('✅ Modelo salvo no localStorage:', modeloLocal.id);
        
        // 2. Tentar salvar no servidor
        console.log('📡 Enviando dados para o servidor...');
        
        // Obter dados do usuário autenticado
        const userData = window.auth?.dadosUsuario ? {
            nome: window.auth.dadosUsuario().nome,
            email: window.auth.dadosUsuario().email,
            funcao: window.auth.dadosUsuario().funcao,
            departamento: window.auth.dadosUsuario().departamento,
            genero: window.auth.dadosUsuario().genero
        } : null;
        
        console.log('👤 Dados do usuário para envio:', userData);
        
        const response = await fetch('/api/save-modelo-resposta', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                dadosFormulario: dadosAtuais,
                respostaAprovada: respostaAprovada,
                userData: userData
            })
        });
        
        console.log('📡 Resposta do servidor:', response.status, response.statusText);
        const data = await response.json();
        console.log('📝 Dados retornados pelo servidor:', data);
        
        if (data.success) {
            console.log('✅ Modelo salvo com sucesso no servidor:', data.modeloId);
            showSuccessMessage(`✅ Resposta salva como modelo para "${dadosAtuais.tipo_solicitacao}"! Futuras solicitações similares usarão este exemplo como referência.`);
        } else {
            console.error('❌ Erro do servidor:', data.error);
            console.log('⚠️ Modelo salvo apenas no localStorage devido ao erro do servidor');
            showSuccessMessage(`✅ Resposta salva como modelo (backup local) para "${dadosAtuais.tipo_solicitacao}"!`);
        }
        
    } catch (error) {
        console.error('❌ Erro ao salvar modelo:', error);
        console.log('⚠️ Modelo salvo apenas no localStorage devido ao erro');
        showSuccessMessage(`✅ Resposta salva como modelo (backup local) para "${dadosAtuais.tipo_solicitacao}"!`);
    }
}

// Função para sincronizar dados do localStorage com o servidor (versão simplificada)
async function sincronizarDadosLocais() {
    try {
        console.log('🔄 Verificando dados do localStorage...');
        
        // Carregar dados do localStorage
        const modelosRespostas = JSON.parse(localStorage.getItem('modelos_respostas_coerentes') || '[]');
        
        if (modelosRespostas.length === 0) {
            console.log('📭 Nenhum modelo local para sincronizar');
            return;
        }
        
        console.log(`📊 Encontrados ${modelosRespostas.length} modelos no localStorage`);
        console.log('💡 Os dados estão salvos localmente e serão usados pelo sistema');
        
    } catch (error) {
        console.error('❌ Erro ao verificar dados locais:', error);
    }
}

// Função para solicitar feedback do usuário antes da reformulação
function solicitarFeedbackParaReformulacao(dadosAtuais, respostaAtual) {
    // Criar modal para feedback
    const modalHTML = `
        <div class="modal fade" id="feedbackModal" tabindex="-1" aria-labelledby="feedbackModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="feedbackModalLabel">
                            <i class="fas fa-comment-dots me-2"></i>
                            Feedback para Aprendizado
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="feedback-text" class="form-label">
                                <strong>Por que a resposta está incoerente?</strong>
                            </label>
                            <p class="text-muted small">Descreva o que está errado para que o sistema aprenda e melhore futuras respostas.</p>
                            <textarea class="form-control" id="feedback-text" rows="4" 
                                placeholder="Ex: Tom inadequado, informações incorretas, falta de clareza, não condiz com a solução implementada..."></textarea>
                        </div>
                        
                        <div class="mb-3">
                            <label class="form-label"><strong>Problemas identificados:</strong></label>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="tom-inadequado" id="problema-tom">
                                <label class="form-check-label" for="problema-tom">
                                    Tom inadequado (muito formal/informal)
                                </label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="informacoes-incorretas" id="problema-info">
                                <label class="form-check-label" for="problema-info">
                                    Informações incorretas ou imprecisas
                                </label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="nao-condiz-solucao" id="problema-solucao">
                                <label class="form-check-label" for="problema-solucao">
                                    Não condiz com a solução implementada
                                </label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="falta-clareza" id="problema-clareza">
                                <label class="form-check-label" for="problema-clareza">
                                    Falta de clareza ou objetividade
                                </label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="nao-empatico" id="problema-empatia">
                                <label class="form-check-label" for="problema-empatia">
                                    Falta de empatia com o cliente
                                </label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="outro" id="problema-outro">
                                <label class="form-check-label" for="problema-outro">
                                    Outro problema
                                </label>
                            </div>
                        </div>
                        
                        <div class="alert alert-info">
                            <i class="fas fa-info-circle me-2"></i>
                            <strong>Importante:</strong> Este feedback será usado para melhorar futuras respostas do sistema.
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            <i class="fas fa-times me-2"></i>
                            Cancelar
                        </button>
                        <button type="button" class="btn btn-warning" onclick="processarFeedbackReformulacao()">
                            <i class="fas fa-redo me-2"></i>
                            Reformular com Feedback
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remover modal anterior se existir
    const modalAnterior = document.getElementById('feedbackModal');
    if (modalAnterior) {
        modalAnterior.remove();
    }
    
    // Adicionar modal ao body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Armazenar dados para uso posterior
    window.dadosReformulacao = dadosAtuais;
    window.respostaReformulacao = respostaAtual;
    
    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('feedbackModal'));
    modal.show();
}

// Função para processar o feedback e reformular
async function processarFeedbackReformulacao() {
    const feedbackText = document.getElementById('feedback-text').value.trim();
    const checkboxes = document.querySelectorAll('#feedbackModal input[type="checkbox"]:checked');
    const problemas = Array.from(checkboxes).map(cb => cb.value);
    
    if (!feedbackText && problemas.length === 0) {
        showErrorMessage('Por favor, forneça um feedback ou selecione pelo menos um problema identificado.');
        return;
    }
    
    // Combinar feedback
    let feedbackCompleto = '';
    if (feedbackText) {
        feedbackCompleto += feedbackText;
    }
    if (problemas.length > 0) {
        feedbackCompleto += '\n\nProblemas identificados: ' + problemas.join(', ');
    }
    
    // Feedback será aplicado diretamente no script de formulação
    // Não é necessário armazenar temporariamente
    console.log('📝 Feedback será aplicado diretamente no script de formulação para aprendizado imediato');
    
    // Fechar modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('feedbackModal'));
    modal.hide();
    
    // Mostrar loading
    showLoadingMessage('Reformulando resposta com base no seu feedback...');
    
    try {
        const novaResposta = await reformularRespostaComFeedback(
            window.dadosReformulacao, 
            window.respostaReformulacao, 
            feedbackCompleto
        );
            
            // Atualizar resposta na interface
            document.getElementById('texto-resposta-gpt5').value = novaResposta;
            
            // Salvar no histórico
            const itemHistorico = {
                id: Date.now(),
            dados: window.dadosReformulacao,
                resposta: novaResposta,
            resposta_anterior: window.respostaReformulacao,
            feedback: feedbackCompleto,
            status: 'reformulada_com_feedback',
                timestamp: new Date().toISOString()
            };
            historicoRespostas.unshift(itemHistorico);
            
        showSuccessMessage('Resposta reformulada com sucesso baseada no seu feedback!');
        
        // Limpar dados temporários
        delete window.dadosReformulacao;
        delete window.respostaReformulacao;
            
        } catch (error) {
            console.error('Erro ao reformular resposta:', error);
            showErrorMessage('Erro ao reformular resposta. Tente novamente.');
        }
    }

async function reformularRespostaComFeedback(dados, respostaAnterior, feedback) {
    // Obter dados do usuário autenticado
    const userData = window.auth?.dadosUsuario ? {
        nome: window.auth.dadosUsuario().nome,
        email: window.auth.dadosUsuario().email,
        funcao: window.auth.dadosUsuario().funcao,
        departamento: window.auth.dadosUsuario().departamento,
        genero: window.auth.dadosUsuario().genero
    } : null;
    
    // Chamar servidor para reformular com feedback
    const response = await fetch('/api/reformulate-response', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            dadosFormulario: dados,
            respostaAnterior: respostaAnterior,
            feedback: feedback,
            userData: userData
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro na requisição');
    }
    
    const data = await response.json();
    
    if (data.success) {
        return data.result;
    } else {
        throw new Error(data.error || 'Erro ao reformular resposta');
    }
}

// Função para cancelar a reformulação
function cancelarReformulacao() {
    // Esconder o modal de feedback se estiver aberto
    const modal = document.getElementById('modal-feedback-reformulacao');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Limpar qualquer campo de feedback
    const campoFeedback = document.getElementById('feedback-reformulacao');
    if (campoFeedback) {
        campoFeedback.value = '';
    }
    
    // Esconder botões de reformulação
    const botoesReformulacao = document.getElementById('botoes-reformulacao');
    if (botoesReformulacao) {
        botoesReformulacao.style.display = 'none';
    }
    
    // Esconder botões de confirmação final
    const botoesConfirmacao = document.getElementById('botoes-confirmacao-final');
    if (botoesConfirmacao) {
        botoesConfirmacao.style.display = 'none';
    }
    
    console.log('❌ Reformulação cancelada');
}

function gerarRespostaReformulada(dados, respostaAnterior) {
    let resposta = '';
    
    // Saudação mais formal
    resposta += 'Prezado(a) cliente,\n\n';
    
    // Agradecimento inicial
    resposta += 'Agradecemos seu contato e lamentamos pelo transtorno causado.\n\n';
    
    // Conteúdo mais detalhado baseado no tipo
    switch (dados.tipo_solicitacao) {
        case 'exclusao-chave-pix-cpf':
            resposta += 'Informamos que sua solicitação de exclusão de chave Pix CPF foi devidamente processada em nossos sistemas.\n\n';
            resposta += 'Conforme regulamentação do Banco Central do Brasil (Resolução nº 4.753/2021), o prazo para processamento é de até 2 dias úteis.\n\n';
            resposta += 'A exclusão será efetivada automaticamente em sua conta, não sendo necessária nenhuma ação adicional de sua parte.\n\n';
            break;
        case 'exclusao-cadastro':
            resposta += 'Confirmamos o recebimento de sua solicitação de exclusão de cadastro.\n\n';
            resposta += 'Conforme previsto na Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018, art. 16), sua solicitação será processada em até 15 dias úteis.\n\n';
            resposta += 'Após a conclusão do processo, você receberá uma confirmação por e-mail.\n\n';
            break;
        case 'juros-abusivos':
            resposta += 'Informamos que todos os juros aplicados em sua operação estão em estrita conformidade com a legislação vigente.\n\n';
            resposta += 'Nossos cálculos seguem rigorosamente as diretrizes do Banco Central do Brasil e as cláusulas contratuais estabelecidas em sua Cédula de Crédito Bancário (CCB).\n\n';
            resposta += 'Caso tenha dúvidas sobre os cálculos, nossa equipe está disponível para esclarecimentos detalhados.\n\n';
            break;
        default:
            resposta += 'Sua solicitação foi devidamente registrada em nossos sistemas e está sendo analisada por nossa equipe especializada.\n\n';
            resposta += 'Em breve entraremos em contato com as informações necessárias para resolver sua situação.\n\n';
    }
    
    // Adicionar solução implementada de forma mais clara
    if (dados.solucao_implementada) {
        resposta += 'Solução implementada: ' + dados.solucao_implementada + '\n\n';
    }
    
    // Fechamento mais profissional
    resposta += 'Seguimos à disposição para esclarecimentos adicionais.\n\n';
    resposta += `Atenciosamente,\nEquipe ${NOME_EMPRESA}`;
    
    return resposta.trim();
}

// ===== FUNÇÕES DE HISTÓRICO E RASCUNHOS =====

function verHistorico() {
    const listaHistorico = document.getElementById('lista-historico');
    listaHistorico.innerHTML = '';
    
    if (historicoRespostas.length === 0) {
        listaHistorico.innerHTML = '<p class="text-muted">Nenhuma resposta no histórico.</p>';
    } else {
        historicoRespostas.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'card mb-2';
            div.innerHTML = `
                <div class="card-body p-2">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <h6 class="mb-1">${item.dados.tipo_solicitacao}</h6>
                            <small class="text-muted">${new Date(item.timestamp).toLocaleString()}</small>
                            <span class="badge bg-${getStatusColor(item.status)} ms-2">${item.status}</span>
                        </div>
                        <div>
                            <button class="btn btn-sm btn-outline-primary" onclick="carregarDoHistorico(${index})">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            listaHistorico.appendChild(div);
        });
    }
    
    document.getElementById('historico-respostas').style.display = 'block';
}

function getStatusColor(status) {
    switch (status) {
        case 'gerada': return 'secondary';
        case 'aprovada': return 'success';
        case 'reformulada': return 'warning';
        default: return 'secondary';
    }
}

function carregarDoHistorico(index) {
    const item = historicoRespostas[index];
    if (item) {
        // Carregar dados no formulário
        document.getElementById('tipo-situacao').value = item.dados.tipo_solicitacao;
        document.getElementById('id-reclamacao').value = item.dados.id_reclamacao || '';
        document.getElementById('reclamacao-text').value = item.dados.texto_cliente;
        const solucaoEl = document.getElementById('solucao-implementada');
        if (solucaoEl) solucaoEl.value = item.dados.solucao_implementada || '';
        const historicoEl = document.getElementById('historico-atendimento');
        if (historicoEl) historicoEl.value = item.dados.historico_atendimento || '';
        const nomeSolEl = document.getElementById('nome-solicitante');
        if (nomeSolEl) nomeSolEl.value = item.dados.nome_solicitante || item.dados.observacoes_internas || '';
        
        // Carregar resposta
        document.getElementById('texto-resposta-gpt5').value = item.resposta;
        document.getElementById('resposta-gpt5').style.display = 'block';
        
        fecharHistorico();
        showSuccessMessage('Dados carregados do histórico!');
    }
}

function fecharHistorico() {
    document.getElementById('historico-respostas').style.display = 'none';
}

function salvarRascunho() {
    const dadosRascunho = {
        id: Date.now(),
        tipo_situacao: document.getElementById('tipo-situacao').value,
        id_reclamacao: document.getElementById('id-reclamacao').value.trim(),
        reclamacao: document.getElementById('reclamacao-text').value,
        solucao: document.getElementById('solucao-implementada')?.value || '',
        historico: document.getElementById('historico-atendimento')?.value || '',
        nome_solicitante: document.getElementById('nome-solicitante')?.value.trim() || '',
        timestamp: new Date().toISOString()
    };
    
    rascunhos.unshift(dadosRascunho);
    
    // Manter apenas os últimos 10 rascunhos
    if (rascunhos.length > 10) {
        rascunhos = rascunhos.slice(0, 10);
    }
    
    showSuccessMessage('Rascunho salvo com sucesso!');
}

function carregarRascunho() {
    if (rascunhos.length === 0) {
        showErrorMessage('Nenhum rascunho salvo.');
        return;
    }
    
    // Usar o rascunho mais recente
    const rascunho = rascunhos[0];
    
    document.getElementById('tipo-situacao').value = rascunho.tipo_situacao;
    document.getElementById('id-reclamacao').value = rascunho.id_reclamacao || '';
    document.getElementById('reclamacao-text').value = rascunho.reclamacao;
    const solucaoRascEl = document.getElementById('solucao-implementada');
    if (solucaoRascEl) solucaoRascEl.value = rascunho.solucao || '';
    const historicoRascEl = document.getElementById('historico-atendimento');
    if (historicoRascEl) historicoRascEl.value = rascunho.historico || '';
    const nomeRascEl = document.getElementById('nome-solicitante');
    if (nomeRascEl) nomeRascEl.value = rascunho.nome_solicitante || rascunho.observacoes || '';
    
    showSuccessMessage('Rascunho carregado com sucesso!');
}

// ===== FUNÇÕES AUXILIARES PARA IA OPENAI =====

function copiarRespostaOpenAI() {
    const texto = document.getElementById('texto-resposta-gpt5').value;
    
    if (!texto || (typeof texto === 'string' && !texto.trim())) {
        showErrorMessage('Não há texto para copiar.');
        return;
    }
    
    navigator.clipboard.writeText(texto).then(() => {
        showSuccessMessage('Resposta copiada para a área de transferência!');
    }).catch(() => {
        showErrorMessage('Erro ao copiar texto.');
    });
}

function limparRespostaOpenAI() {
    document.getElementById('texto-resposta-gpt5').value = '';
    document.getElementById('resposta-gpt5').style.display = 'none';
    showSuccessMessage('Resposta limpa com sucesso!');
}

function showLoadingMessage(message) {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-message';
    loadingDiv.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${message}`;
    
    // Tentar diferentes seletores para encontrar o container
    const container = document.querySelector('.container') || 
                     document.querySelector('.container-fluid') || 
                     document.body;
    
    container.appendChild(loadingDiv);
    
    setTimeout(() => {
        if (loadingDiv.parentNode) {
            loadingDiv.remove();
        }
    }, 5000);
}

// Variável para controlar qual exemplo mostrar
let exemploAtual = 0;

// Array com diferentes exemplos de teste
const exemplosTeste = [
    {
        nome: "Exclusão de Cadastro - Realizada",
        tipoSituacao: "incoerente",
        idReclamacao: "RA-12345",
        reclamacaoCliente: `Cliente solicita exclusão de seu cadastro da ${NOME_EMPRESA}. Ele não quer mais receber comunicações e deseja que todos os seus dados sejam removidos dos sistemas.`,
        solucaoImplementada: "Cadastro excluído no sistema em 12/08/2025 conforme solicitação.",
        historicoAtendimento: "Cliente já havia solicitado exclusão via WhatsApp em 15/01/2025, mas não recebeu confirmação.",
        nomeSolicitante: "Maria"
    },
    {
        nome: "Exclusão de Cadastro - Negada",
        tipoSituacao: "incoerente",
        idReclamacao: "RA-12346",
        reclamacaoCliente: `Cliente solicita exclusão de seu cadastro da ${NOME_EMPRESA}. Ele não quer mais receber comunicações e deseja que todos os seus dados sejam removidos dos sistemas.`,
        solucaoImplementada: "Não foi possível realizar a exclusão do cadastro devido a pendências contratuais ativas.",
        historicoAtendimento: "Cliente possui operação em andamento que impede a exclusão.",
        nomeSolicitante: "João"
    },
    {
        nome: "Liberação de Chave Pix - Realizada",
        tipoSituacao: "conta-celcoin",
        idReclamacao: "RA-12347",
        reclamacaoCliente: "Cliente solicita liberação da chave Pix CPF para portabilidade. Ele quer transferir para outro banco.",
        solucaoImplementada: "Portabilidade da chave Pix concluída e confirmada em contato com o cliente.",
        historicoAtendimento: "Cliente já havia tentado fazer a portabilidade anteriormente.",
        nomeSolicitante: "Carlos"
    },
    {
        nome: "Liberação de Chave Pix - Negada",
        tipoSituacao: "conta-celcoin",
        idReclamacao: "RA-12348",
        reclamacaoCliente: "Cliente solicita liberação da chave Pix CPF para portabilidade. Ele quer transferir para outro banco.",
        solucaoImplementada: "Não foi possível realizar a liberação da chave Pix devido a operação ativa.",
        historicoAtendimento: "Cliente possui antecipação em andamento que impede a liberação.",
        nomeSolicitante: "Ana"
    },
    {
        nome: "Quitação - Realizada",
        tipoSituacao: "antecipacao",
        idReclamacao: "RA-12349",
        reclamacaoCliente: "Cliente questiona sobre quitação de antecipação. Ele acredita que já quitou mas ainda aparece débito.",
        solucaoImplementada: "Antecipação quitada automaticamente em 31/07/2025 quando restituição foi depositada pela Receita Federal.",
        historicoAtendimento: "Cliente recebeu restituição do IR em 31/07/2025.",
        nomeSolicitante: "Pedro"
    },
    {
        nome: "SERASA/SPC - Inclusão",
        tipoSituacao: "em-cobranca",
        idReclamacao: "RA-12350",
        reclamacaoCliente: "Cliente questiona inclusão em SERASA/SPC. Ele não entende por que foi incluído.",
        solucaoImplementada: "Antecipação não foi quitada na data prevista, resultando em inclusão nos órgãos de proteção ao crédito.",
        historicoAtendimento: "Cliente não quitou a antecipação no prazo estabelecido.",
        nomeSolicitante: "Fernanda"
    },
    {
        nome: "Análise em Andamento",
        tipoSituacao: "incoerente",
        idReclamacao: "RA-12351",
        reclamacaoCliente: `Cliente solicita exclusão de seu cadastro da ${NOME_EMPRESA}. Ele não quer mais receber comunicações.`,
        solucaoImplementada: "Solicitação em análise pela equipe técnica. Aguardando verificação de pendências.",
        historicoAtendimento: "Cliente fez a solicitação há 2 dias úteis.",
        nomeSolicitante: "Roberto"
    },
    {
        nome: "Juros Abusivos - Análise",
        tipoSituacao: "juros-abusivos",
        idReclamacao: "RA-12352",
        reclamacaoCliente: "Cliente reclama de juros abusivos na antecipação. Ele acredita que os valores estão incorretos.",
        solucaoImplementada: "Análise dos cálculos em andamento pela equipe financeira. Verificando aplicação das taxas contratuais.",
        historicoAtendimento: "Cliente questionou os valores há 3 dias úteis.",
        nomeSolicitante: "Lucia"
    }
];

// Função de teste para debug com exemplos rotativos
function testarFuncao() {
    console.log('=== TESTE DE FUNÇÃO ===');
    console.log('Exemplo atual:', exemploAtual + 1);
    
    try {
        // Verificar se os elementos existem
        const elementos = {
            'tipo-situacao': document.getElementById('tipo-situacao'),
            'id-reclamacao': document.getElementById('id-reclamacao'),
            'reclamacao-text': document.getElementById('reclamacao-text'),
            'solucao-implementada': document.getElementById('solucao-implementada')
        };
        
    console.log('Elementos encontrados:');
        let elementosFaltando = [];
        
        for (const [id, elemento] of Object.entries(elementos)) {
            if (elemento) {
                console.log(`✅ ${id}:`, elemento);
            } else {
                console.log(`❌ ${id}: NÃO ENCONTRADO`);
                elementosFaltando.push(id);
            }
        }
        
        if (elementosFaltando.length > 0) {
            console.error('Elementos faltando:', elementosFaltando);
            showErrorMessage(`Erro: Elementos não encontrados: ${elementosFaltando.join(', ')}`);
            return;
        }
        
        // Obter o exemplo atual
        const exemplo = exemplosTeste[exemploAtual];
        console.log('Exemplo selecionado:', exemplo.nome);
        
        // Preencher campos com o exemplo atual
        console.log('Preenchendo campos com exemplo...');
        
        elementos['tipo-situacao'].value = exemplo.tipoSituacao;
        elementos['id-reclamacao'].value = exemplo.idReclamacao || '';
        elementos['reclamacao-text'].value = exemplo.reclamacaoCliente;
        elementos['solucao-implementada'].value = exemplo.solucaoImplementada;
        const exHistoricoEl = document.getElementById('historico-atendimento');
        if (exHistoricoEl) exHistoricoEl.value = exemplo.historicoAtendimento || '';
        const exNomeEl = document.getElementById('nome-solicitante');
        if (exNomeEl) exNomeEl.value = exemplo.nomeSolicitante || '';
        
        // Verificar se os valores foram definidos
        console.log('Valores definidos:');
        console.log('- tipo-situacao:', elementos['tipo-situacao'].value);
        console.log('- id-reclamacao:', elementos['id-reclamacao'].value);
        console.log('- reclamacao-text:', elementos['reclamacao-text'].value.substring(0, 50) + '...');
        console.log('- solucao-implementada:', elementos['solucao-implementada'].value.substring(0, 50) + '...');
        
        console.log('✅ Campos preenchidos com exemplo:', exemplo.nome);
        
        // Mostrar mensagem de sucesso com o nome do exemplo
        showSuccessMessage(`Exemplo ${exemploAtual + 1}/${exemplosTeste.length}: ${exemplo.nome} - Agora clique em "Gerar Resposta com IA OpenAI"`);
        
        // Avançar para o próximo exemplo (rotativo)
        exemploAtual = (exemploAtual + 1) % exemplosTeste.length;
        
        console.log('Próximo exemplo será:', exemploAtual + 1);
        
    } catch (error) {
        console.error('❌ Erro na função de teste:', error);
        showErrorMessage('❌ Erro na função de teste: ' + error.message);
    }
}

// ===== FUNÇÕES DE MODERAÇÃO =====

// Mensagem exata retornada quando a auditoria não valida nenhuma hipótese (espelha o servidor)
const MSG_VALIDACAO_HIPOTESE_FALHOU = 'Não foi possível validar objetivamente uma hipótese de moderação suficientemente sustentada pelos fatos apresentados.';

// Extrai conteúdo entre o primeiro marcador de início e o primeiro marcador de fim após ele
function extrairBlocoModeracaoPorMarcadores(texto, inicioMarcadores, fimMarcadores) {
    let startIdx = -1;
    let startMarkerLen = 0;
    for (const marcador of inicioMarcadores) {
        const idx = texto.indexOf(marcador);
        if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
            startIdx = idx;
            startMarkerLen = marcador.length;
        }
    }
    if (startIdx === -1) return '';
    const corpoInicio = startIdx + startMarkerLen;
    let endIdx = texto.length;
    for (const marcador of fimMarcadores) {
        const idx = texto.indexOf(marcador, corpoInicio);
        if (idx !== -1 && idx < endIdx) endIdx = idx;
    }
    return texto.substring(corpoInicio, endIdx).trim();
}

// Função para separar auditoria da hipótese, linha de raciocínio e texto de moderação
// Compatível com o formato antigo de 2 blocos (fallback legado).
function separarBlocosModeracao(resposta) {
    if (!resposta) return { auditoriaHipotese: '', linhaRaciocinio: '', textoFinal: '', validacaoFalhou: false };

    const marcadoresAuditoria = [
        '(1) AUDITORIA DA HIPÓTESE',
        'AUDITORIA DA HIPÓTESE (USO INTERNO)',
        '1. AUDITORIA DA HIPÓTESE',
        'AUDITORIA DA HIPÓTESE'
    ];
    const marcadoresRaciocinio = [
        '(2) LINHA DE RACIOCÍNIO INTERNA',
        '(1) LINHA DE RACIOCÍNIO INTERNA',
        'LINHA DE RACIOCÍNIO INTERNA',
        '1. LINHA DE RACIOCÍNIO INTERNA',
        '2. LINHA DE RACIOCÍNIO INTERNA'
    ];
    const marcadoresTexto = [
        '(3) TEXTO FINAL DE MODERAÇÃO',
        '(2) TEXTO FINAL DE MODERAÇÃO',
        'TEXTO FINAL DE MODERAÇÃO',
        '2. TEXTO FINAL DE MODERAÇÃO',
        '3. TEXTO FINAL DE MODERAÇÃO'
    ];

    let auditoriaHipotese = extrairBlocoModeracaoPorMarcadores(
        resposta,
        marcadoresAuditoria,
        marcadoresRaciocinio.concat(marcadoresTexto)
    );
    let linhaRaciocinio = extrairBlocoModeracaoPorMarcadores(resposta, marcadoresRaciocinio, marcadoresTexto);
    let textoFinal = extrairBlocoModeracaoPorMarcadores(resposta, marcadoresTexto, []);

    // Fallback legado: formato antigo com apenas dois blocos
    if (!auditoriaHipotese && !linhaRaciocinio && !textoFinal) {
        const marcadoresLegado = [
            '(1) LINHA DE RACIOCÍNIO INTERNA',
            '(2) TEXTO FINAL DE MODERAÇÃO',
            'LINHA DE RACIOCÍNIO INTERNA',
            'TEXTO FINAL DE MODERAÇÃO',
            '1. LINHA DE RACIOCÍNIO INTERNA',
            '2. TEXTO FINAL DE MODERAÇÃO'
        ];
        for (let i = 0; i < marcadoresLegado.length; i += 2) {
            const marcador1 = marcadoresLegado[i];
            const marcador2 = marcadoresLegado[i + 1];
            const index1 = resposta.indexOf(marcador1);
            const index2 = resposta.indexOf(marcador2);
            if (index1 !== -1 && index2 !== -1) {
                linhaRaciocinio = resposta.substring(index1 + marcador1.length, index2).trim();
                textoFinal = resposta.substring(index2 + marcador2.length).trim();
                break;
            }
        }
        if (!linhaRaciocinio && !textoFinal) {
            const partes = resposta.split('\n\n');
            if (partes.length >= 2) {
                linhaRaciocinio = partes[0].trim();
                textoFinal = partes.slice(1).join('\n\n').trim();
            } else {
                textoFinal = resposta;
            }
        }
    }

    // Sinal informativo de confiança baixa (fallback); nunca zera o pedido
    const alvoConfianca = (auditoriaHipotese || resposta).toLowerCase();
    const validacaoFalhou = /confian[çc]a\s*(:|-|—)?\s*baixa/.test(alvoConfianca)
        || alvoConfianca.includes('confiança baixa')
        || alvoConfianca.includes(MSG_VALIDACAO_HIPOTESE_FALHOU.toLowerCase());

    return { auditoriaHipotese, linhaRaciocinio, textoFinal, validacaoFalhou };
}

// Função para formatar a auditoria da hipótese (uso interno)
function formatarAuditoriaHipotese(auditoria, confiancaBaixa) {
    if (!auditoria) return '';

    let conteudoFormatado = auditoria
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');

    let bloco = '<div class="auditoria-hipotese">';
    bloco += '<h6 class="text-warning mb-3"><i class="fas fa-search me-2"></i>Auditoria da Hipótese (uso interno — não enviar ao RA):</h6>';
    if (confiancaBaixa) {
        bloco += '<div class="alert alert-warning border-start border-warning border-4 mb-2"><strong><i class="fas fa-exclamation-triangle me-2"></i>Confiança baixa na hipótese.</strong> O pedido foi gerado mesmo assim; revise a aderência antes de enviar ao RA.</div>';
    }
    bloco += `<div class="alert alert-light border-start border-warning border-4">${conteudoFormatado}</div>`;
    bloco += '</div>';
    return bloco;
}

// Função para formatar a linha de raciocínio interna do servidor
function formatarLinhaRaciocinioServidor(linhaRaciocinio) {
    if (!linhaRaciocinio) return '';
    
    let linha = '<div class="linha-raciocinio servidor">';
    linha += '<h6 class="text-info mb-3"><i class="fas fa-brain me-2"></i>Linha de Raciocínio Interna (Gerada pelo Servidor):</h6>';
    
    // Formatar o conteúdo da linha de raciocínio
    let conteudoFormatado = linhaRaciocinio
        .replace(/\n\n/g, '</p><p>')  // Dupla quebra de linha = novo parágrafo
        .replace(/\n/g, '<br>')       // Quebra simples = <br>
        .replace(/^/, '<p>')          // Iniciar com <p>
        .replace(/$/, '</p>');        // Terminar com </p>
    
    // Destacar elementos importantes
    conteudoFormatado = conteudoFormatado
        .replace(/Fatos reais comprovados:/gi, '<strong class="text-success">Fatos reais comprovados:</strong>')
        .replace(/Divergência\/violação:/gi, '<strong class="text-danger">Divergência/violação:</strong>')
        .replace(/Base normativa:/gi, '<strong class="text-primary">Base normativa:</strong>')
        .replace(/Manual Geral/g, '<em class="text-info">Manual Geral</em>')
        .replace(/Manual de Reviews/g, '<em class="text-info">Manual de Reviews</em>')
        .replace(/Manual de Bancos/g, '<em class="text-info">Manual de Bancos</em>')
        .replace(/Manual de Moderação/g, '<em class="text-info">Manual de Moderação</em>');
    
    linha += `<div class="alert alert-light border-start border-info border-4">${conteudoFormatado}</div>`;
    linha += '</div>';
    
    return linha;
}

// Função para formatar o texto de moderação com melhor apresentação
function formatarTextoModeracao(texto) {
    if (!texto) return '';
    
    // Quebrar o texto em parágrafos baseado em quebras de linha
    let textoFormatado = texto
        .replace(/\n\n/g, '</p><p>')  // Dupla quebra de linha = novo parágrafo
        .replace(/\n/g, '<br>')       // Quebra simples = <br>
        .replace(/^/, '<p>')          // Iniciar com <p>
        .replace(/$/, '</p>');        // Terminar com </p>
    
    // Destacar frases importantes
    textoFormatado = textoFormatado
        .replace(/Prezados,/g, '<strong>Prezados,</strong>')
        .replace(/Solicitamos a moderação/g, '<strong>Solicitamos a moderação</strong>')
        .replace(/Conforme registros internos/g, '<strong>Conforme registros internos</strong>')
        .replace(/Dessa forma, solicitamos/g, '<strong>Dessa forma, solicitamos</strong>')
        .replace(/Manual Geral/g, '<em>Manual Geral</em>')
        .replace(/Manual de Reviews/g, '<em>Manual de Reviews</em>')
        .replace(/Manual de Bancos/g, '<em>Manual de Bancos</em>')
        .replace(/Manual de Moderação/g, '<em>Manual de Moderação</em>');
    
    // Adicionar título
    return `<h6 class="text-primary mb-3"><i class="fas fa-shield-alt me-2"></i>Texto para Moderação:</h6>${textoFormatado}`;
}

async function gerarModeracao() {
    // Nova geração: qualquer negativa/hipótese/encadeamento de tentativa de um caso carregado
    // anteriormente não vale mais — essa é uma moderação nova e independente.
    window._textoNegativaRAAtual = '';
    window._hipoteseUtilizadaAtual = '';
    window._moderacaoIdAnterior = '';

    const idReclamacao = document.getElementById('id-reclamacao-moderacao').value.trim();
    const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
    const respostaEmpresa = document.getElementById('resposta-empresa').value;
    const motivoModeracao = document.getElementById('motivo-moderacao').value;
    const consideracaoFinal = (document.getElementById('consideracao-final-moderacao') || {}).value || '';
    
    // Validação obrigatória do ID da reclamação
    if (!idReclamacao) {
        showErrorMessage('Por favor, preencha o ID da Reclamação (Reclame Aqui). Este campo é obrigatório.');
        document.getElementById('id-reclamacao-moderacao').focus();
        return;
    }
    
    // Validar se o ID contém apenas números
    if (!/^\d+$/.test(idReclamacao)) {
        showErrorMessage('O ID da Reclamação deve conter apenas números.');
        document.getElementById('id-reclamacao-moderacao').focus();
        return;
    }
    
    if (!solicitacaoCliente || (typeof solicitacaoCliente === 'string' && !solicitacaoCliente.trim()) || !motivoModeracao) {
        showErrorMessage('Por favor, preencha a solicitação do cliente e selecione o motivo da moderação.');
        return;
    }
    
    // Mostrar loading
    showLoadingMessage('Gerando solicitação de moderação com modelo pré-definido...');
    
    try {
        // Chamar o endpoint do servidor que usa o modelo pré-definido
        const response = await fetch('/api/generate-moderation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                idReclamacao: idReclamacao,
                dadosModeracao: {
                    solicitacaoCliente: solicitacaoCliente,
                    respostaEmpresa: respostaEmpresa,
                    motivoModeracao: motivoModeracao,
                    consideracaoFinal: consideracaoFinal
                }
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Processar a resposta (auditoria interna + linha de raciocínio + texto do pedido)
            const resposta = data.result;

            // Preferir os campos estruturados do servidor; se ausentes, reparsear localmente
            const blocos = separarBlocosModeracao(resposta);
            const auditoria = (typeof data.auditoriaHipotese === 'string' && data.auditoriaHipotese) ? data.auditoriaHipotese : blocos.auditoriaHipotese;
            const confiancaBaixa = (typeof data.confiancaBaixa === 'boolean') ? data.confiancaBaixa : blocos.validacaoFalhou;
            const linhaRaciocinioBruta = (typeof data.linhaRaciocinio === 'string' && data.linhaRaciocinio) ? data.linhaRaciocinio : blocos.linhaRaciocinio;
            const textoFinalBruto = (typeof data.textoModeracao === 'string' && data.textoModeracao) ? data.textoModeracao : blocos.textoFinal;

            const elAuditoria = document.getElementById('auditoria-hipotese');
            if (elAuditoria) elAuditoria.innerHTML = formatarAuditoriaHipotese(auditoria, confiancaBaixa);
            window._hipoteseUtilizadaAtual = auditoria || '';

            // O pedido é SEMPRE gerado; a auditoria apenas melhora o enquadramento
            const linhaRaciocinio = formatarLinhaRaciocinioServidor(linhaRaciocinioBruta);
            const textoModeracao = formatarTextoModeracao(textoFinalBruto);

            document.getElementById('linha-raciocinio').innerHTML = linhaRaciocinio;
            document.getElementById('texto-moderacao').innerHTML = textoModeracao;
            document.getElementById('moderacao-resultado').style.display = 'block';

            // Recarregar estatísticas globais do servidor
            carregarEstatisticasGlobais();

            if (confiancaBaixa) {
                showSuccessMessage('Moderação gerada. Atenção: a auditoria sinalizou confiança baixa na hipótese, revise antes de enviar.');
            } else {
                showSuccessMessage('Solicitação de moderação gerada com script estruturado!');
            }
        } else {
            throw new Error(data.error || 'Erro ao gerar moderação');
        }
    } catch (error) {
        console.error('Erro ao gerar moderação:', error);
        showErrorMessage('Erro ao gerar moderação. Usando modelo local como fallback.');
        
        // Fallback para o modelo local
        const elAuditoriaFallback = document.getElementById('auditoria-hipotese');
        if (elAuditoriaFallback) elAuditoriaFallback.innerHTML = '';
        const linhaRaciocinio = gerarLinhaRaciocinioModeracao(motivoModeracao, solicitacaoCliente, respostaEmpresa);
        const textoModeracao = gerarTextoModeracao(motivoModeracao, consideracaoFinal);
        
        document.getElementById('linha-raciocinio').innerHTML = linhaRaciocinio;
        document.getElementById('texto-moderacao').innerHTML = textoModeracao;
        document.getElementById('moderacao-resultado').style.display = 'block';
        
        // Recarregar estatísticas globais do servidor
        carregarEstatisticasGlobais();
        
        showSuccessMessage('Solicitação de moderação gerada (modelo local)!');
    }
}

function gerarLinhaRaciocinioModeracao(motivoModeracao, solicitacaoCliente, respostaEmpresa) {
    let linha = '<div class="linha-raciocinio">';
    linha += '<h6 class="text-info mb-3"><i class="fas fa-brain me-2"></i>Linha de Raciocínio Interna:</h6>';
    
    linha += '<div class="alert alert-light border-start border-info border-4 mb-3">';
    linha += '<p class="mb-2"><strong>Análise do Conteúdo:</strong></p>';
    linha += '<p class="mb-0">O conteúdo em questão apresenta violação às regras do Reclame Aqui pelos seguintes motivos:</p>';
    linha += '</div>';
    
    // Mapear motivos com descrições mais detalhadas
    const motivosDetalhados = {
        'reclamacao-outra-empresa': {
            titulo: 'Reclamação Direcionada a Outra Empresa',
            descricao: `A reclamação é direcionada a outra empresa, não à ${NOME_EMPRESA}`,
            manual: 'Manual de Reviews',
            fundamento: 'Reclamações devem ser direcionadas à empresa correta'
        },
        'reclamacao-trabalhista': {
            titulo: 'Questão Trabalhista',
            descricao: 'Trata-se de questão trabalhista, não de relação de consumo',
            manual: 'Manual de Reviews',
            fundamento: 'O RA não é o canal adequado para questões trabalhistas'
        },
        'conteudo-improprio': {
            titulo: 'Conteúdo Inadequado',
            descricao: 'O conteúdo contém linguagem inadequada ou ofensiva',
            manual: 'Manual Geral',
            fundamento: 'Violação às diretrizes de conduta da plataforma'
        },
        'reclamacao-duplicidade': {
            titulo: 'Reclamação Duplicada',
            descricao: 'Esta é uma reclamação duplicada já registrada anteriormente',
            manual: 'Manual de Reviews',
            fundamento: 'Evita spam e duplicação de conteúdo'
        },
        'reclamacao-terceiros': {
            titulo: 'Reclamação por Terceiros',
            descricao: 'A reclamação é feita por terceiros não autorizados',
            manual: 'Manual Geral',
            fundamento: 'Apenas o consumidor direto pode reclamar'
        },
        'caso-fraude': {
            titulo: 'Caso de Fraude',
            descricao: 'Este é um caso comprovado de fraude',
            manual: 'Manual de Bancos/Instituições Financeiras/Meios',
            fundamento: 'Fraude não constitui relação de consumo válida'
        },
        'nao-violou-direito': {
            titulo: 'Não Houve Violação',
            descricao: 'A empresa não violou o direito do consumidor',
            manual: 'Manual de Bancos/Instituições Financeiras/Meios',
            fundamento: 'A empresa agiu em conformidade com a legislação'
        }
    };
    
    const motivo = motivosDetalhados[motivoModeracao] || {
        titulo: 'Violação às Regras',
        descricao: 'Violação às regras do Reclame Aqui',
        manual: 'Manual Geral',
        fundamento: 'Conteúdo não adequado à plataforma'
    };
    
    linha += '<div class="card mb-3">';
    linha += '<div class="card-header bg-warning text-dark">';
    linha += `<h6 class="mb-0"><i class="fas fa-exclamation-triangle me-2"></i>${motivo.titulo}</h6>`;
    linha += '</div>';
    linha += '<div class="card-body">';
    linha += `<p class="mb-2"><strong>Descrição:</strong> ${motivo.descricao}</p>`;
    linha += `<p class="mb-2"><strong>Manual Aplicável:</strong> <em>${motivo.manual}</em></p>`;
    linha += `<p class="mb-0"><strong>Fundamento:</strong> ${motivo.fundamento}</p>`;
    linha += '</div>';
    linha += '</div>';
    
    if (solicitacaoCliente && typeof solicitacaoCliente === 'string' && solicitacaoCliente.trim()) {
        linha += '<div class="mb-3">';
        linha += '<h6 class="text-secondary"><i class="fas fa-user me-2"></i>Solicitação do Cliente:</h6>';
        linha += `<div class="bg-light p-3 rounded border-start border-secondary border-4">`;
        linha += `<p class="mb-0">${solicitacaoCliente}</p>`;
        linha += '</div>';
        linha += '</div>';
    }
    
    if (respostaEmpresa && respostaEmpresa.trim()) {
        linha += '<div class="mb-3">';
        linha += '<h6 class="text-success"><i class="fas fa-building me-2"></i>Resposta da Empresa:</h6>';
        linha += `<div class="bg-light p-3 rounded border-start border-success border-4">`;
        linha += `<p class="mb-0">${respostaEmpresa}</p>`;
        linha += '</div>';
        linha += '</div>';
    }
    
    linha += '</div>';
    return linha;
}

function gerarTextoModeracao(motivoModeracao, consideracaoFinal) {
    let texto = '<p><strong>Texto para Moderação:</strong></p>';
    
    texto += '<p>Prezados,</p>';
    texto += '<p>Solicitamos a moderação do conteúdo acima pelos seguintes motivos:</p>';
    
    const motivos = {
        'reclamacao-outra-empresa': `A reclamação é direcionada a outra empresa, não à ${NOME_EMPRESA}.`,
        'reclamacao-trabalhista': 'Trata-se de questão trabalhista, não de relação de consumo.',
        'conteudo-improprio': 'O conteúdo contém linguagem inadequada ou ofensiva.',
        'reclamacao-duplicidade': 'Esta é uma reclamação duplicada já registrada anteriormente.',
        'reclamacao-terceiros': 'A reclamação é feita por terceiros não autorizados.',
        'caso-fraude': 'Este é um caso comprovado de fraude.',
        'nao-violou-direito': 'A empresa não violou o direito do consumidor.'
    };
    
    texto += '<p>' + (motivos[motivoModeracao] || 'Violação às regras da plataforma.') + '</p>';
    
    if (consideracaoFinal && consideracaoFinal.trim()) {
        texto += '<p><strong>Consideração Final:</strong></p>';
        texto += `<p>${consideracaoFinal}</p>`;
    }
    
    texto += '<p>Agradecemos a atenção.</p>';
    
    return texto;
}

// ===== FUNÇÕES DE EXPLICAÇÕES =====

async function gerarExplicacao() {
    const tema = document.getElementById('tema-explicacao').value;
    
    if (!tema) {
        showErrorMessage('Por favor, selecione o tema a explicar.');
        return;
    }
    
    // Mostrar loading
    showLoadingMessage('Gerando explicação baseada em feedbacks...');
    
    try {
        // Chamar o endpoint do servidor para gerar explicação
        const response = await fetch('/api/generate-explanation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tema: tema
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const explicacao = data.result;
            
            document.getElementById('explicacao-content').innerHTML = explicacao;
            document.getElementById('explicacao-resultado').style.display = 'block';
            
            // Recarregar estatísticas globais do servidor
            carregarEstatisticasGlobais();
            
            showSuccessMessage('Explicação gerada com sucesso baseada em feedbacks!');
        } else {
            throw new Error(data.error || 'Erro ao gerar explicação');
        }
    } catch (error) {
        console.error('Erro ao gerar explicação:', error);
        showErrorMessage('Erro ao gerar explicação. Tente novamente.');
    }
}

function gerarMensagemExplicativa(tema, contexto) {
    const explicacoes = {
        'malha-fina': `
            <p><strong>Prezado(a) cliente,</strong></p>
            <p>Vamos esclarecer sobre a Malha Fina:</p>
            <ol>
                <li><strong>O que é:</strong> É um sistema de fiscalização da Receita Federal que identifica inconsistências na declaração do IR.</li>
                <li><strong>Como funciona:</strong> O sistema compara as informações declaradas com dados de terceiros.</li>
                <li><strong>Prazo para resposta:</strong> Você tem 30 dias para se manifestar após receber a notificação.</li>
                <li><strong>Como resolver:</strong> É necessário apresentar documentos que comprovem as informações declaradas.</li>
                <li><strong>Penalidades:</strong> Caso não seja respondida, pode gerar multas e juros.</li>
            </ol>
            <p>Nossa equipe está disponível para orientações sobre como proceder em seu caso específico.</p>
        `,
        'exclusao': `
            <p><strong>Prezado(a) cliente,</strong></p>
            <p>Se você deseja excluir sua conta na ${NOME_EMPRESA}, preparamos um passo a passo simples. Você pode fazer isso de duas formas:</p>
            
            <p><strong>🔹 1. Pelo aplicativo</strong></p>
            <ol>
                <li>Abra o app da ${NOME_EMPRESA} no seu celular.</li>
                <li>Toque no ícone de Impostos</li>
                <li>Selecione a opção "DARFs para investidores".</li>
                <li>No canto superior direito, toque no ícone de menu (☰).</li>
                <li>Role a tela lateral esquerda até encontrar a opção "Conta".</li>
                <li>Role até o final e toque em "Excluir conta".</li>
            </ol>
            
            <p><strong>🔹 2. Pelo site</strong></p>
            <ol>
                <li>Acesse: ${SITE_EMPRESA}</li>
                <li>Faça login com seu CPF e senha.</li>
                <li>No menu inferior, do lado esquerdo, clique em "Conta".</li>
                <li>Role a página até o final e clique em "Excluir conta".</li>
            </ol>
            
            <p><strong>⚠️ Importante</strong></p>
            <p>A exclusão será feita conforme a Lei Geral de Proteção de Dados (LGPD), garantindo segurança e privacidade. Todas as informações registradas (declarações, relatórios e documentos fiscais) serão apagadas definitivamente. Lembrando que a exclusão de seus dados não cancela planos ativos em cobrança.</p>
        `,
        'procuracoes': `
            <p><strong>Prezado(a) cliente,</strong></p>
            <p>Para revogar procurações no eCAC, siga os passos abaixo:</p>
            <ol>
                <li>Acesse www.gov.br/receitafederal</li>
                <li>Clique em "eCAC" e faça login</li>
                <li>No menu, selecione "Procurações"</li>
                <li>Escolha "Revogar Procuração"</li>
                <li>Selecione a procuração a ser revogada</li>
                <li>Confirme a operação</li>
            </ol>
            <p>A revogação é imediata e você receberá confirmação por e-mail.</p>
            <p>Em caso de dificuldades, nossa equipe está disponível para orientações.</p>
        `,
        'ccb': `
            <p><strong>Prezado(a) cliente,</strong></p>
            <p>A Cédula de Crédito Bancário (CCB) é um título de crédito que representa uma promessa de pagamento. Vamos esclarecer todas as cláusulas contratuais:</p>
            
            <p><strong>📋 CLÁUSULAS DA CCB:</strong></p>
            
            <p><strong>Cláusula 1 - Partes e Definições:</strong><br>
            Identifica quem empresta (credor/instituição), quem toma o crédito (devedor/cliente) e define termos usados no contrato como "Chave Pix", "Conta de Pagamento" e "Antecipação".</p>
            
            <p><strong>Cláusula 2 - Objeto do Contrato:</strong><br>
            Explica qual operação está sendo contratada — antecipação de restituição, empréstimo com garantia de restituição, ou outra modalidade.</p>
            
            <p><strong>Cláusula 3 - Valor, Liberação e Conta de Crédito:</strong><br>
            Estabelece o montante, data de liberação e conta para depósito do valor contratado.</p>
            
            <p><strong>Cláusula 4 - Vencimento e Forma de Pagamento:</strong><br>
            Define quando e como a dívida será paga — parcelamento, vencimento único ou amortizações. A dívida será quitada automaticamente com o crédito da restituição do Imposto de Renda.</p>
            
            <p><strong>Cláusula 5 - Juros, Encargos e Forma de Cálculo:</strong><br>
            Especifica os juros remuneratórios, juros de mora, encargos, periodicidade de capitalização e método de cálculo.</p>
            
            <p><strong>Cláusula 6 - Atualização Monetária:</strong><br>
            Trata de reajuste por índice (IPCA, INPC, TR) ou cláusula de correção do saldo devedor.</p>
            
            <p><strong>Cláusula 7 - Vínculo da Chave Pix e Quitação Automática:</strong><br>
            ⚠️ <strong>CRÍTICA:</strong> Determina que a restituição depositada na Conta de Pagamento vinculada à Chave Pix será utilizada prioritariamente para quitação da operação. A alteração ou exclusão da Chave Pix sem notificação prévia pode caracterizar descumprimento contratual.</p>
            
            <p><strong>Cláusula 8 - Liquidação Antecipada:</strong><br>
            O cliente pode liquidar antecipadamente, total ou parcialmente, o saldo devedor a qualquer tempo, beneficiando-se de desconto sobre os juros e encargos futuros.</p>
            
            <p><strong>Cláusula 9 - Garantias e Cessão de Direitos:</strong><br>
            Pode prever garantias (alienação fiduciária, cessão de crédito) e regras para cessão/cessão de crédito pelo credor.</p>
            
            <p><strong>Cláusula 10 - Inadimplência e Vencimento Antecipado:</strong><br>
            ⚠️ <strong>CRÍTICA:</strong> Lista eventos de inadimplência (não pagamento, informações falsas, uso indevido da Conta de Pagamento) e prevê que o credor pode tornar o saldo exigível imediatamente.</p>
            
            <p><strong>Cláusula 11 - Multas, Encargos de Cobrança e Custas:</strong><br>
            Descreve multas por atraso, encargos de cobrança, honorários advocatícios e custos de execução em caso de inadimplência.</p>
            
            <p><strong>Cláusula 12 - Compensação / Set-off:</strong><br>
            Permite ao credor compensar créditos/débitos entre contas do cliente e dívidas pendentes.</p>
            
            <p><strong>Cláusula 13 - Notificações e Comunicações:</strong><br>
            Define como se dão avisos entre as partes, prazo para responder e efeitos da notificação.</p>
            
            <p><strong>Cláusula 14 - Proteção de Dados (LGPD):</strong><br>
            Trata do tratamento de dados pessoais do cliente para execução contratual e cumprimento legal conforme a Lei Geral de Proteção de Dados.</p>
            
            <p><strong>Cláusula 15 - Direito de Arrependimento / Desistência:</strong><br>
            Quando aplicável, prevê prazo de arrependimento (7 dias corridos) e procedimentos de devolução.</p>
            
            <p><strong>Cláusula 16 - Impostos, Tributos e Despesas:</strong><br>
            Define quem arca com impostos e despesas decorrentes da operação.</p>
            
            <p><strong>Cláusula 17 - Cessão, Sub-rogação e Transferência:</strong><br>
            Regula quando o credor pode ceder os direitos e obrigações a terceiros.</p>
            
            <p><strong>Cláusula 18 - Foro e Legislação Aplicável:</strong><br>
            Estabelece a lei que rege o contrato e o foro para resolver conflitos.</p>
            
            <p><strong>Cláusula 19 - Alterações Contratuais e Integralidade:</strong><br>
            Define que alterações só valem por escrito e que o contrato integra o entendimento entre as partes.</p>
            
            <p><strong>Cláusula 20 - Força Maior e Caso Fortuito:</strong><br>
            Prevê que eventos extraordinários podem suspender obrigações sem penalidade.</p>
            
            <p><strong>Cláusula 21 - Interpretação e Cláusula Separável:</strong><br>
            Se uma cláusula for considerada nula, o restante permanece válido.</p>
            
            <p><strong>⚠️ IMPORTANTE:</strong><br>
            É fundamental que você leia atentamente todas as cláusulas do contrato antes de assinar, compreendendo os termos, condições, taxas de juros, prazos e consequências do não cumprimento das obrigações assumidas.</p>
            
            <p>Nossa equipe está disponível para orientações adicionais sobre qualquer cláusula específica da CCB.</p>
        `,
        'credito-trabalhador': `
            <p><strong>👷‍♂️ Crédito do Trabalhador - Informações Completas</strong></p>
            
            <p><strong>O que é o Crédito do Trabalhador?</strong></p>
            <p>O Crédito do Trabalhador é uma modalidade de consignado que oferece mais praticidade e segurança, pois as parcelas são descontadas diretamente do salário ou benefício, sem risco de atraso ou esquecimento. Essa estrutura garante maior controle financeiro, diferentemente do empréstimo pessoal, em que o cliente precisa administrar boletos ou débitos automáticos. Além disso, por ser consignado, costuma apresentar taxas mais acessíveis, tornando-se uma opção mais vantajosa e estável para quem busca crédito com condições mais favoráveis.</p>
            
            <p><strong>📋 Base Legal:</strong> Lei 15.179 de 25/07/2025 (alteração da Lei 10.820 de 2003).</p>
            <p><strong>⚙️ Mecanismo:</strong> Desconto via Guia de pagamento do FGTS.</p>
            
            <p><strong>👥 Para quem é destinado?</strong></p>
            <p>O Crédito do Trabalhador é exclusivo para:</p>
            <ul>
                <li><strong>Trabalhadores domésticos</strong> - Categoria 104 do eSocial</li>
                <li><strong>Trabalhadores com carteira assinada (CLT)</strong> - Categoria 101 do eSocial</li>
                <li><strong>Diretores com conta no FGTS</strong> - Categoria 721 do eSocial</li>
            </ul>
            
            <p><strong>✅ Critérios específicos do Velotax:</strong></p>
            <ul>
                <li>Tempo mínimo de vínculo: <strong>12 meses</strong></li>
                <li>Empresa com status "Ativa" e mais de <strong>24 meses</strong> de cadastramento</li>
            </ul>
            
            <p><strong>💰 Exemplo de Cálculo da Margem:</strong></p>
            <ul>
                <li>Salário Líquido: R$ 2.000,00</li>
                <li>Margem Consignável: 25%</li>
                <li>Valor Disponível: R$ 500,00</li>
            </ul>
            
            <p><strong>⏰ Prazos Importantes:</strong></p>
            <ul>
                <li><strong>Liberação:</strong> Via PIX CPF</li>
                <li><strong>Tempo:</strong> Até 30 minutos</li>
                <li><strong>Carência para o 1º vencimento de parcela:</strong> 60 ou 92 dias</li>
            </ul>
            
            <p><strong>🚫 Não elegíveis:</strong></p>
            <ul>
                <li>Funcionários afastados</li>
                <li>Funcionários em aviso prévio</li>
                <li>Funcionários com data de demissão incluída</li>
            </ul>
            
            <p><strong>🎁 Benefícios para o Cliente:</strong></p>
            <ul>
                <li><strong>Taxa de juros reduzida:</strong> Em comparação a outros tipos de crédito, como cartão de crédito e empréstimo pessoal</li>
                <li><strong>Parcelas fixas e previsíveis:</strong> Sem surpresas no orçamento mensal, facilitando o planejamento financeiro</li>
                <li><strong>Troca de dívidas caras:</strong> Possibilidade de substituir dívidas com juros altos por um empréstimo mais justo</li>
                <li><strong>Praticidade:</strong> Desconto automático na folha de pagamento, sem preocupação com boletos</li>
                <li><strong>Acesso facilitado ao crédito:</strong> Especialmente para trabalhadores que encontram barreiras em outros tipos de empréstimo</li>
                <li><strong>Processo 100% digital:</strong> Todo o processo pode ser realizado pelo aplicativo Velotax, sem burocracia</li>
            </ul>
            
            <p><strong>📱 Passo a Passo da Contratação:</strong></p>
            <p><strong>Processo 100% digital e simplificado</strong></p>
            <ol>
                <li><strong>Acesso e Autorização:</strong> O cliente acessa o aplicativo do Velotax e seleciona a opção Crédito do Trabalhador. Autoriza a Consulta de Margem (validade: 45 dias).</li>
                <li><strong>Análise e Validação:</strong> O Velotax valida a elegibilidade, vínculo, margem e informações da empresa do cliente.</li>
                <li><strong>Proposta e Assinatura:</strong> Após aprovação, o cliente recebe a proposta com as condições, confirma no app e assina o contrato digital.</li>
                <li><strong>Averbação:</strong> O contrato é averbado no sistema (disponível das 06h às 22h, 7 dias por semana).</li>
                <li><strong>Liberação do Crédito:</strong> O valor é disponibilizado exclusivamente via PIX CPF em até 30 minutos após a averbação.</li>
            </ol>
            
            <p><strong>📄 Documentação Necessária:</strong></p>
            <ul>
                <li>Selfie com liveness</li>
                <li>Cópia do RG/CPF/CNH</li>
            </ul>
            
            <p><strong>📅 Datas de Contratação e Vencimento:</strong></p>
            <ul>
                <li><strong>Até dia 20:</strong> Vencimento da primeira parcela 2 meses depois</li>
                <li><strong>A partir do dia 21:</strong> Vencimento da primeira parcela 3 meses depois</li>
            </ul>
            
            <p><strong>❌ Resultado Negativo:</strong></p>
            <p>A análise de crédito pode resultar em aprovação ou não. Se o resultado for negativo, informe apenas que não há oferta disponível no momento. O cliente poderá realizar uma nova tentativa após 30 dias. Caso necessário, oriente a entrar em contato com o suporte para mais informações.</p>
            
            <p><strong>⚠️ Possível motivo de atrito:</strong></p>
            <p>O repasse do consignado é realizado pela Caixa Econômica Federal, e a baixa do pagamento pode levar até 2 dias úteis após o envio pela empresa. Por esse motivo, mesmo que o cliente tenha solicitado o cancelamento dentro do prazo de 7 dias, ainda pode ocorrer a cobrança da primeira parcela após o período de carência (60 a 92 dias). Nesses casos, é importante orientar o cliente com clareza e acolhimento, registrar um chamado imediatamente e acionar o supervisor para acompanhamento da situação.</p>
            
            <p><strong>❓ Perguntas Frequentes:</strong></p>
            <p><strong>Quem pode solicitar o Crédito do Trabalhador?</strong><br>
            Trabalhadores com carteira assinada (CLT), incluindo domésticos e diretores com conta no FGTS, com vínculo mínimo de 12 meses.</p>
            
            <p><strong>Qual o valor máximo das parcelas?</strong><br>
            No Velotax, as parcelas podem comprometer no máximo 25% do salário líquido, embora a lei permita até 35%.</p>
            
            <p><strong>Posso ter mais de um empréstimo ao mesmo tempo?</strong><br>
            É permitido um empréstimo por vínculo de trabalho. Inicialmente, o Velotax permite no máximo um contrato por CPF.</p>
            
            <p><strong>Como o FGTS pode ser usado nesse empréstimo?</strong><br>
            O FGTS pode ser usado como garantia para reduzir os juros. Em caso de demissão, o saldo pode quitar parte ou toda a dívida restante.</p>
            
            <p><strong>Posso cancelar o empréstimo depois de contratado?</strong><br>
            Sim, você tem até 7 dias corridos após receber o dinheiro para devolver o valor e cancelar, sem multa.</p>
            
            <p><strong>Tenho restrição no nome, posso contratar?</strong><br>
            Em muitos casos, sim. A análise considera a política de crédito, avaliando além de restrições, a existência de emprego estável e outros fatores.</p>
            
            <p><strong>Já quitei meu contrato. Em quanto tempo consta no sistema a baixa e a desaverbação? E quando posso solicitar o Crédito do Trabalhador novamente?</strong><br>
            Após a quitação, a baixa e a desaverbação do contrato acontecem em até 2 dias úteis. Somente após esse prazo o sistema libera a possibilidade de contratar novamente o Crédito do Trabalhador. Em resumo: o cliente pode solicitar um novo crédito a partir de 2 dias úteis após a quitação.</p>
            
            <p><strong>💡 Como o Atendimento Deve se Posicionar:</strong></p>
            <p>Use uma <strong>linguagem clara</strong> e <strong>acolhedora</strong>. Evite começar a conversa com termos difíceis ou muito técnicos, que podem gerar confusão logo no início. Explique de forma didática o funcionamento do produto e seus benefícios. Confirme o entendimento do cliente sobre como funciona o desconto em folha. Reforce a transparência: todas as condições estarão descritas no contrato acessível pelo app.</p>
            
            <p><strong>Dicas para um atendimento eficaz:</strong></p>
            <ul>
                <li>Seja <strong>acolhedor</strong> e demonstre interesse genuíno em ajudar</li>
                <li>Ofereça soluções personalizadas de acordo com o perfil do cliente</li>
                <li>Garanta a <strong>confiança</strong> e <strong>fidelização</strong> através do seu atendimento</li>
            </ul>
            
            <p><strong>Exemplo de explicação:</strong><br>
            "O valor da parcela é descontado direto do seu salário, o que facilita o controle financeiro e permite juros menores."</p>
            
            <p>Nossa equipe está disponível para orientações adicionais sobre o Crédito do Trabalhador.</p>
        `,
        'credito-pessoal': `
            <p><strong>💰 Crédito Pessoal Velotax - Informações Completas</strong></p>
            
            <p><strong>O que é o Empréstimo Pessoal?</strong></p>
            <p>O Empréstimo Pessoal é uma linha de crédito concedida a pessoas físicas por instituições financeiras. Nessa modalidade, o cliente recebe um valor e o paga em parcelas mensais com juros, sem a necessidade de oferecer garantias ou justificar o uso do dinheiro. Esse tipo de crédito oferece flexibilidade e praticidade, podendo ser utilizado para diferentes finalidades, como quitar dívidas, investir em educação, cobrir emergências ou realizar projetos pessoais.</p>
            
            <p><strong>📋 Características do Produto - Empréstimo Pessoal Velotax:</strong></p>
            <ul>
                <li><strong>Valor do limite:</strong> R$ 500,00</li>
                <li><strong>Parcelamento:</strong> 4 parcelas, com vencimento a cada 30 dias</li>
                <li><strong>Data de vencimento:</strong> Definida automaticamente, com base na movimentação financeira do cliente via Open Finance</li>
                <li><strong>Contratos ativos:</strong> Não é permitido ter mais de um contrato ativo ao mesmo tempo</li>
                <li><strong>Pagamento antecipado:</strong> Possível pelo app, mas não garante liberação imediata de novo crédito nem aumento de limite</li>
                <li><strong>Cobrança em atraso:</strong> Operações inadimplentes serão tratadas pela equipe interna de cobrança do Velotax</li>
                <li><strong>Faixa etária:</strong> 18 a 75 anos para todos os clientes</li>
            </ul>
            
            <p><strong>🔗 O que é Open Finance?</strong></p>
            <p>O Open Finance é como se fosse uma "ponte segura" que conecta diferentes bancos e instituições financeiras. Ele permite que você, com a sua autorização, compartilhe suas informações financeiras (como saldo, histórico de movimentações ou limites de crédito) de um banco para outro. Assim, em vez de cada banco conhecer só uma parte da sua vida financeira, eles passam a ter uma visão mais completa — e isso ajuda a oferecer melhores condições de crédito, taxas mais baixas e serviços feitos sob medida para você.</p>
            
            <p><strong>⚙️ Como funciona na prática:</strong></p>
            <ol>
                <li><strong>Consentimento:</strong> Você decide se quer ou não compartilhar seus dados e escolhe exatamente qual banco ou empresa poderá acessá-los</li>
                <li><strong>Compartilhamento seguro:</strong> Esses dados viajam por um sistema de segurança chamado API, que funciona como uma "ponte digital": onde só a instituição autorizada consegue acessar</li>
                <li><strong>Benefícios para você:</strong> Com essas informações, os bancos conseguem entender melhor o seu perfil e oferecer soluções personalizadas, como fácil contratação, aumento do limite de crédito e investimentos mais adequados ao seu bolso</li>
            </ol>
            
            <p><strong>💡 Exemplo simples:</strong><br>
            O Open Finance é como uma estrada com pedágio: só passa quem tem autorização, garantindo que a viagem seja segura. A API é o carro blindado que transporta as informações nessa estrada, protegendo tudo durante o trajeto.</p>
            
            <p><strong>ℹ️ Saiba que:</strong><br>
            Durante a jornada de contratação, pode aparecer para o cliente o símbolo de um 'b' amarelo ao autorizar a conexão com o Open Finance. A Belvo é a empresa autorizada que atua como nossa parceira na tecnologia do Open Finance.</p>
            
            <p><strong>📱 Como Contratar o Crédito Pessoal?</strong></p>
            <p><strong>O processo é simples e 100% digital, feito diretamente no aplicativo Velotax:</strong></p>
            <ol>
                <li><strong>Acesso ao produto:</strong> O cliente acessa o aplicativo Velotax e seleciona o ícone do Empréstimo Pessoal na tela inicial</li>
                <li><strong>Apresentação do produto:</strong> É exibida uma tela com as principais características do empréstimo</li>
                <li><strong>Conexão com o Open Finance:</strong> O cliente autoriza a conexão para análise de crédito e risco de fraude</li>
                <li><strong>Oferta de crédito:</strong> Se aprovado, o cliente visualiza o limite disponível (atualmente R$ 500,00)</li>
                <li><strong>Proposta de empréstimo:</strong> O aplicativo apresenta simulação com: valor contratado, juros e encargos (sigla CET), valor total a pagar, data da primeira parcela e número de parcelas</li>
                <li><strong>Orientação de pagamento:</strong> O cliente é informado sobre a importância de manter os pagamentos em dia e que poderá quitar via Pix Copia e Cola</li>
                <li><strong>Confirmação e assinatura:</strong> O cliente revisa todas as condições, lê a CCB (Contrato de Crédito Bancário) e assina digitalmente para confirmar a contratação</li>
                <li><strong>Liberação do crédito:</strong> O app mostra a confirmação e, em poucos minutos, o valor contratado é creditado na mesma conta corrente vinculada ao Open Finance</li>
            </ol>
            
            <p><strong>❌ Resultado Negativo:</strong></p>
            <p>A análise de crédito pode resultar em aprovação ou não. Se o resultado for negativo, informe apenas que não há oferta disponível no momento. O cliente poderá realizar uma nova tentativa após 30 dias. Caso necessário, oriente a entrar em contato com o suporte para mais informações.</p>
            
            <p><strong>🚫 Cancelamento do Produto – Empréstimo Pessoal Velotax:</strong></p>
            <ul>
                <li>O cliente poderá solicitar o cancelamento do contrato em até 7 dias após a contratação, conforme previsto em lei</li>
                <li>Para o cancelamento, será necessário devolver o valor integral recebido, por meio de PIX</li>
                <li>Após esse prazo, não será mais possível cancelar o contrato. O cliente deverá seguir com o pagamento das parcelas pelo aplicativo Velotax, conforme as condições contratadas, incluindo a incidência de juros e encargos previstos no contrato</li>
            </ul>
            
            <p><strong>💳 Como Quitar o Empréstimo?</strong></p>
            <ol>
                <li>Acessar a página inicial do app Velotax</li>
                <li>Rolar até a seção "Próximos Pagamentos"</li>
                <li>Selecionar "Crédito Pessoal"</li>
                <li>Conferir o valor a ser quitado</li>
                <li>Escolher uma das opções de pagamento disponíveis: PIX ou cartão de crédito</li>
            </ol>
            
            <p>O cliente poderá antecipar parcelas diretamente pelo aplicativo Velotax ou aguardar os lembretes de cobrança enviados por notificações. O pagamento será realizado preferencialmente via Pix Copia e Cola. O cartão de crédito poderá ser oferecido como alternativa, em especial para clientes em atraso.</p>
            
            <p><strong>⚠️ Em caso de não pagamento:</strong> Poderão ser aplicadas medidas de cobrança, incluindo negativação em órgãos de proteção ao crédito e, em alguns casos, protesto em cartório.</p>
            
            <p><strong>📌 Observações Importantes:</strong></p>
            <ul>
                <li>A análise de crédito é feita via Open Finance</li>
                <li><strong>Bancos disponíveis atualmente:</strong> Nubank, Itaú (Pessoa Física), Bradesco (Pessoa Física), Santander (Pessoa Física), Banco do Brasil, Caixa Econômica</li>
                <li>Caso o banco desejado não esteja disponível, não será possível seguir com a vinculação</li>
                <li><strong>Tempo de análise:</strong> até 5 minutos. Se a tela "Aguarde" estiver ativa, oriente o cliente a permanecer aguardando</li>
                <li><strong>Após a aprovação:</strong> o valor é enviado à conta do cliente entre 30 minutos e 24 horas</li>
                <li><strong>Limite inicial:</strong> até R$ 500,00</li>
                <li><strong>Parcelamento:</strong> em até 4 vezes</li>
            </ul>
            
            <p><strong>❓ Perguntas Frequentes sobre o Crédito Pessoal Velotax:</strong></p>
            
            <p><strong>1. O cliente pode alterar o valor da oferta inicial ou reduzir os juros?</strong><br>
            Resposta: Não. Nesta versão inicial, o valor é fixo em R$ 500,00, parcelado em até 4 vezes, com taxa de juros de 19% a.m.</p>
            
            <p><strong>2. O cliente já possui outro produto ativo com o Velotax. Ele pode contratar o Empréstimo Pessoal simultaneamente?</strong><br>
            Resposta: Não. Clientes que já contrataram o Crédito do Trabalhador ou que possuem débitos de Antecipação IRPF precisam quitar esses produtos antes de solicitar o Empréstimo Pessoal.</p>
            
            <p><strong>3. O consentimento do Open Finance é obrigatório?</strong><br>
            Resposta: Sim. O cliente só poderá avançar para a análise de crédito mediante consentimento no Open Finance.</p>
            
            <p><strong>4. Após o consentimento, o empréstimo é aprovado automaticamente?</strong><br>
            Resposta: Não. As informações financeiras do cliente são avaliadas para verificar se há crédito disponível.</p>
            
            <p><strong>5. O cliente pode ser aprovado com conta em qualquer banco?</strong><br>
            Resposta: Não. No momento, aceitamos apenas clientes com conta no Itaú, Bradesco, Santander, Banco do Brasil, Nubank e Inter.</p>
            
            <p><strong>6. O cliente realizou o consentimento, mas a tela não avançou. Isso significa que houve problema?</strong><br>
            Resposta: Não. O processo de análise via Open Finance pode levar entre 2 e 5 minutos para validar todas as informações.</p>
            
            <p><strong>7. O cliente realizou o consentimento, mas o crédito não foi aprovado. Ele pode solicitar novamente?</strong><br>
            Resposta: Sim. O cliente poderá tentar novamente após 30 dias.</p>
            
            <p><strong>8. É necessária biometria ou envio de documentos para contratar o Empréstimo Pessoal?</strong><br>
            Resposta: Não. Nesta primeira versão do produto, não haverá exigência de biometria ou envio de documentos adicionais.</p>
            
            <p><strong>9. O empréstimo foi aprovado, mas o cliente ainda não tem certeza se deseja contratar. Ele pode finalizar depois?</strong><br>
            Resposta: Sim. A proposta permanece válida por 10 dias.</p>
            
            <p><strong>10. O empréstimo foi aprovado, mas a chave Pix do cliente foi recusada. Ele pode corrigir?</strong><br>
            Resposta: Sim. A chave Pix deve ser obrigatoriamente o CPF do cliente e estar vinculada à mesma conta informada no Open Finance. Basta refazer o processo e tentar novamente.</p>
            
            <p><strong>11. O cliente pode escolher a data de vencimento das parcelas?</strong><br>
            Resposta: Não. A data de vencimento será definida automaticamente, de acordo com a análise do fluxo financeiro via Open Finance.</p>
            
            <p><strong>12. O cliente pode pagar o empréstimo com cartão de crédito?</strong><br>
            Resposta: Sim, mas essa opção será disponibilizada preferencialmente para clientes em atraso.</p>
            
            <p><strong>13. O cliente pagou em atraso. Isso aumenta o valor da parcela?</strong><br>
            Resposta: Sim. Em caso de atraso, será cobrada multa de 2% e encargos de 1% ao mês.</p>
            
            <p><strong>14. O cliente não pagou a dívida. Ele pode ser negativado?</strong><br>
            Resposta: Sim. Caso o atraso não seja regularizado, o contrato poderá ser enviado aos órgãos de proteção ao crédito.</p>
            
            <p>Nossa equipe está disponível para orientações adicionais sobre o Crédito Pessoal Velotax.</p>
        `
    };
    
    let explicacao = explicacoes[tema] || '<p>Explicação não disponível para este tema.</p>';
    
    if (contexto.trim()) {
        explicacao = explicacao.replace('<p><strong>Prezado(a) cliente,</strong></p>', 
            `<p><strong>Prezado(a) cliente,</strong></p><p><strong>Contexto:</strong> ${contexto}</p>`);
    }
    
    return explicacao;
}

// ===== FUNÇÕES DE REVISÃO =====

function calcularFingerprintChanceModeracao(reclamacaoCompleta, respostaPublica, consideracaoFinal, historicoModeracao) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return [
        norm(reclamacaoCompleta),
        norm(respostaPublica),
        norm(consideracaoFinal),
        norm(historicoModeracao)
    ].join('\x1e');
}

function preencherCamposRevisaoChance({ reclamacaoCompleta, respostaPublica }) {
    const elReclamacao = document.getElementById('reclamacao-completa');
    const elResposta = document.getElementById('resposta-publica');
    if (elReclamacao && reclamacaoCompleta) elReclamacao.value = reclamacaoCompleta;
    if (elResposta && respostaPublica) elResposta.value = respostaPublica;
}

function aplicarResultadoChanceModeracaoRA(payload) {
    const { result, motor, comparacao, deltaPorCriterio, reformulacaoAprovada, avisoRegressao } = payload || {};
    if (!result) return;

    const area = document.getElementById('ra-chance-moderacao-area');
    const elAnalise = document.getElementById('ra-analise-chance-moderacao');
    const elLoading = document.getElementById('ra-chance-moderacao-loading');
    if (!area || !elAnalise) return;

    elLoading.style.display = 'none';
    elAnalise.innerHTML = formatarAnaliseChanceModeracao(result, {
        motor,
        comparacao,
        deltaPorCriterio,
        reformulacaoAprovada,
        avisoRegressao,
        respostaReformulada: payload.respostaReformulada
    });
    area.style.display = 'block';
}

function ocultarLoadingChanceModeracaoRA() {
    const elLoading = document.getElementById('ra-chance-moderacao-loading');
    if (elLoading) elLoading.style.display = 'none';
}

function mostrarLoadingChanceModeracaoRA() {
    const area = document.getElementById('ra-chance-moderacao-area');
    const elLoading = document.getElementById('ra-chance-moderacao-loading');
    const elAnalise = document.getElementById('ra-analise-chance-moderacao');
    if (!area || !elLoading) return;
    area.style.display = 'block';
    elLoading.style.display = 'block';
    if (elAnalise) elAnalise.innerHTML = '';
}

async function aplicarChanceModeracaoPosRespostaRA(payload) {
    const {
        reclamacaoCompleta,
        respostaPublica,
        result,
        origem,
        executionId,
        ...resto
    } = payload;

    preencherCamposRevisaoChance({ reclamacaoCompleta, respostaPublica });

    if (result) {
        aplicarResultadoChanceModeracao({
            result,
            origem: origem || 'pev',
            executionId: executionId || null,
            ...resto
        });
        return;
    }

    const fingerprintAtual = calcularFingerprintChanceModeracao(
        reclamacaoCompleta,
        respostaPublica,
        '',
        ''
    );
    const cache = window.analiseChanceModeracaoCache;
    if (cache && cache.result && cache.fingerprint === fingerprintAtual) {
        aplicarResultadoChanceModeracao({ ...cache });
        return;
    }

    mostrarLoadingChanceModeracaoRA();

    try {
        const solucaoImplementada = document.getElementById('solucao-implementada')?.value || '';
        const response = await fetch('/api/chance-moderacao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reclamacaoCompleta,
                respostaPublica,
                solucaoImplementada,
                consideracaoFinal: '',
                historicoModeracao: ''
            })
        });
        const data = await response.json();
        ocultarLoadingChanceModeracaoRA();

        if (data.success) {
            aplicarResultadoChanceModeracao({
                result: data.result,
                motor: data.motor,
                motorReformulado: data.motorReformulado,
                respostaOriginal: data.respostaOriginal,
                respostaReformulada: data.respostaReformulada,
                respostaSugerida: data.respostaSugerida,
                reformulacaoAprovada: data.reformulacaoAprovada,
                avisoRegressao: data.avisoRegressao,
                comparacao: data.comparacao,
                deltaPorCriterio: data.deltaPorCriterio,
                oportunidadesMelhoria: data.oportunidadesMelhoria,
                versions: data.versions,
                origem: origem || 'ra-auto',
                executionId: null
            });
        } else {
            const area = document.getElementById('ra-chance-moderacao-area');
            const elAnalise = document.getElementById('ra-analise-chance-moderacao');
            if (area && elAnalise) {
                elAnalise.innerHTML = `<p class="text-warning mb-0"><i class="fas fa-exclamation-triangle me-2"></i>Não foi possível calcular a chance de moderação: ${data.error || 'erro desconhecido'}</p>`;
                area.style.display = 'block';
            }
        }
    } catch (error) {
        ocultarLoadingChanceModeracaoRA();
        console.error('Erro ao analisar chance de moderação (RA):', error);
        const area = document.getElementById('ra-chance-moderacao-area');
        const elAnalise = document.getElementById('ra-analise-chance-moderacao');
        if (area && elAnalise) {
            elAnalise.innerHTML = '<p class="text-warning mb-0"><i class="fas fa-exclamation-triangle me-2"></i>Erro ao analisar chance de moderação. Use o botão na aba Revisão para tentar novamente.</p>';
            area.style.display = 'block';
        }
    }
}

function aplicarResultadoChanceModeracao(payload) {
    const {
        result,
        motor,
        motorReformulado,
        respostaOriginal,
        respostaReformulada,
        respostaSugerida,
        reformulacaoAprovada,
        avisoRegressao,
        comparacao,
        deltaPorCriterio,
        oportunidadesMelhoria,
        versions,
        origem,
        executionId
    } = payload || {};

    if (!result) return;

    const reclamacaoCompleta = document.getElementById('reclamacao-completa')?.value || '';
    const respostaPublica = document.getElementById('resposta-publica')?.value || '';
    const consideracaoFinal = document.getElementById('consideracao-final')?.value || '';
    const historicoModeracao = document.getElementById('historico-moderacao')?.value || '';

    const analiseFormatada = formatarAnaliseChanceModeracao(result, {
        motor,
        motorReformulado,
        comparacao,
        deltaPorCriterio,
        reformulacaoAprovada,
        avisoRegressao,
        respostaReformulada
    });
    document.getElementById('analise-chance-moderacao').innerHTML = analiseFormatada;
    document.getElementById('revisao-resultado').style.display = 'block';

    window.respostaRevisadaModeracao = respostaSugerida || respostaReformulada || extrairRespostaRevisada(result);
    window.respostaReformuladaAuditoria = respostaReformulada || null;
    window.analiseCompletaModeracao = result;

    if (window.respostaRevisadaModeracao && window.respostaRevisadaModeracao.trim().length > 0) {
        document.getElementById('btn-ajuste-manual').style.display = 'inline-block';
    }

    window.analiseChanceModeracaoCache = {
        origem: origem || 'manual',
        fingerprint: calcularFingerprintChanceModeracao(
            reclamacaoCompleta,
            respostaPublica,
            consideracaoFinal,
            historicoModeracao
        ),
        result,
        motor: motor || null,
        motorReformulado: motorReformulado || null,
        respostaOriginal: respostaOriginal || respostaPublica,
        respostaReformulada: respostaReformulada || null,
        respostaSugerida: respostaSugerida || null,
        reformulacaoAprovada: reformulacaoAprovada ?? null,
        avisoRegressao: avisoRegressao || null,
        comparacao: comparacao || null,
        deltaPorCriterio: deltaPorCriterio || null,
        oportunidadesMelhoria: oportunidadesMelhoria || null,
        versions: versions || null,
        executionId: executionId || null
    };

    atualizarRotuloBotaoChanceModeracao();
    aplicarResultadoChanceModeracaoRA(payload);
}

function atualizarRotuloBotaoChanceModeracao() {
    const btn = document.getElementById('btn-chance-moderacao');
    if (!btn) return;
    const temCache = window.analiseChanceModeracaoCache?.result;
    const labelSpan = btn.querySelector('.btn-chance-label');
    const texto = temCache ? 'Reanalisar Chance de Moderação' : 'Analisar Chance de Moderação';
    if (labelSpan) {
        labelSpan.textContent = texto;
    } else {
        btn.innerHTML = `<i class="fas fa-percentage me-2"></i><span class="btn-chance-label">${texto}</span>`;
    }
}

async function analisarChanceModeracao() {
    const reclamacaoCompleta = document.getElementById('reclamacao-completa').value;
    const respostaPublica = document.getElementById('resposta-publica').value;
    const consideracaoFinal = document.getElementById('consideracao-final').value;
    const historicoModeracao = document.getElementById('historico-moderacao').value;
    
    if (!reclamacaoCompleta.trim() || !respostaPublica.trim()) {
        showErrorMessage('Por favor, preencha a reclamação completa e a resposta pública da empresa.');
        return;
    }

    const fingerprintAtual = calcularFingerprintChanceModeracao(
        reclamacaoCompleta,
        respostaPublica,
        consideracaoFinal,
        historicoModeracao
    );
    const cache = window.analiseChanceModeracaoCache;
    if (cache && cache.result && cache.fingerprint === fingerprintAtual) {
        aplicarResultadoChanceModeracao({ ...cache });
        const msg = cache.origem === 'pev'
            ? 'Exibindo análise já calculada pelo pipeline (sem nova requisição).'
            : 'Exibindo análise em cache (sem nova requisição).';
        showSuccessMessage(msg);
        return;
    }
    
    // Mostrar loading
    showLoadingMessage('Analisando chance de moderação com IA...');
    
    try {
        const solucaoImplementada = document.getElementById('solucao-implementada')?.value || '';
        // Chamar endpoint do servidor (transporte)
        const response = await fetch('/api/chance-moderacao', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reclamacaoCompleta: reclamacaoCompleta,
                respostaPublica: respostaPublica,
                solucaoImplementada: solucaoImplementada,
                consideracaoFinal: consideracaoFinal || '',
                historicoModeracao: historicoModeracao || ''
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            aplicarResultadoChanceModeracao({
                result: data.result,
                motor: data.motor,
                motorReformulado: data.motorReformulado,
                respostaOriginal: data.respostaOriginal,
                respostaReformulada: data.respostaReformulada,
                respostaSugerida: data.respostaSugerida,
                reformulacaoAprovada: data.reformulacaoAprovada,
                avisoRegressao: data.avisoRegressao,
                comparacao: data.comparacao,
                deltaPorCriterio: data.deltaPorCriterio,
                oportunidadesMelhoria: data.oportunidadesMelhoria,
                versions: data.versions,
                origem: 'manual',
                executionId: null
            });
            showSuccessMessage('Análise de chance de moderação concluída!');
        } else {
            showErrorMessage('Erro na análise: ' + data.error);
        }
        
    } catch (error) {
        console.error('Erro ao analisar chance de moderação:', error);
        showErrorMessage('Erro ao analisar chance de moderação. Tente novamente.');
    }
}

// Função para extrair apenas a resposta revisada do resultado
function extrairRespostaRevisada(resultado) {
    if (!resultado) return '';
    
    // Procurar pela seção "✍️ Revisão de Textos (versão estratégica)"
    const marcadores = [
        '✍️ Revisão de Textos (versão estratégica)',
        'Revisão de Textos (versão estratégica)',
        'REVISÃO DE TEXTOS',
        'Resposta pública revisada'
    ];
    
    for (const marcador of marcadores) {
        const index = resultado.indexOf(marcador);
        if (index !== -1) {
            // Pegar o conteúdo após o marcador até o próximo marcador ou fim
            let conteudo = resultado.substring(index + marcador.length).trim();
            
            // Remover marcadores seguintes se houver
            const proximosMarcadores = ['🧠', '📊', '⚠️', '🎯', '🧩'];
            for (const proxMarcador of proximosMarcadores) {
                const proxIndex = conteudo.indexOf(proxMarcador);
                if (proxIndex !== -1) {
                    conteudo = conteudo.substring(0, proxIndex).trim();
                }
            }
            
            return conteudo.trim();
        }
    }
    
    return '';
}

// Função para copiar resposta sugerida (original ou reformulada conforme guardrail A5)
function copiarRespostaRevisada() {
    const texto = window.respostaRevisadaModeracao || window.analiseChanceModeracaoCache?.respostaSugerida;
    if (!texto) {
        showErrorMessage('Nenhuma resposta sugerida disponível.');
        return;
    }
    
    navigator.clipboard.writeText(texto).then(() => {
        showSuccessMessage('Resposta sugerida copiada para a área de transferência!');
    }).catch(err => {
        console.error('Erro ao copiar:', err);
        showErrorMessage('Erro ao copiar resposta sugerida.');
    });
}

const SECOES_CHANCE_MODERACAO = [
    'Resultado Oficial do Motor',
    'Resumo Executivo',
    'Justificativa dos Critérios do Motor',
    'Tese Principal',
    'Teses Complementares',
    'Fundamentação Técnica',
    'Pontos que reduziram a pontuação',
    'Como aumentar a pontuação',
    'Auditoria dos fatos',
    'Clareza e Fundamentação',
    'Calibração Histórica',
    'Auditoria de Consistência',
    'Revisão Estratégica da Resposta',
    'Comparação Motor #1 × Motor #2'
];

function parseSecoesChanceModeracao(markdown) {
    if (!markdown) return {};
    const secoes = {};
    const regex = /^##\s+(.+)$/gm;
    const matches = [];
    let m;
    while ((m = regex.exec(markdown)) !== null) {
        matches.push({ titulo: m[1].trim(), index: m.index, headerLen: m[0].length });
    }
    for (let i = 0; i < matches.length; i++) {
        const cur = matches[i];
        const inicio = cur.index + cur.headerLen;
        const fim = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
        secoes[cur.titulo] = markdown.slice(inicio, fim).trim();
    }
    return secoes;
}

function escapeHtmlChance(texto) {
    return String(texto || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

// Parser Justificativa (espelho de chance-moderacao/justificativaParser.js) — multilinha + flat.
const JUSTIFICATIVA_TEXTO_TETO = 'Não se aplica — critério já está na pontuação máxima.';
const JUSTIFICATIVA_CAMPOS = [
    { key: 'classificacao', labels: ['classificação', 'classificacao'] },
    { key: 'pontuacao', labels: ['pontuação', 'pontuacao'] },
    { key: 'trechoReclamacao', labels: ['trecho da reclamação', 'trecho da reclamacao'] },
    { key: 'trechoResposta', labels: ['trecho da resposta'] },
    { key: 'justificativaTecnica', labels: ['justificativa técnica', 'justificativa tecnica'] },
    {
        key: 'oQueReduziu',
        labels: ['o que reduziu a pontuação', 'o que reduziu a pontuacao', 'o que reduziu']
    },
    {
        key: 'comoAumentar',
        labels: ['como aumentar a pontuação', 'como aumentar a pontuacao', 'como aumentar']
    }
];

function stripMarkdownJustificativa(texto) {
    return String(texto || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/#{1,6}\s*/g, '')
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/`/g, '')
        .replace(/^\s*[-*•]\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const JUSTIFICATIVA_CAMPOS_HUMANIZAR_TETO = new Set(['oQueReduziu', 'comoAumentar']);

/** Exige "N/A" ou "N / A" com barra — a palavra portuguesa "na" NÃO casa. */
function isNaTetoJustificativa(valor) {
    const v = String(valor || '').toLowerCase().trim();
    if (!v) return false;
    return (
        /\bn\s*\/\s*a\b/.test(v) ||
        v.includes('pontuação máxima') ||
        v.includes('pontuacao maxima') ||
        v.includes('critério já no teto') ||
        v.includes('criterio ja no teto') ||
        v.includes('já está na pontuação máxima') ||
        v.includes('ja esta na pontuacao maxima')
    );
}

function valorCampoFinalJustificativa(key, valor) {
    const limpo = stripMarkdownJustificativa(valor);
    if (JUSTIFICATIVA_CAMPOS_HUMANIZAR_TETO.has(key) && isNaTetoJustificativa(limpo)) {
        return JUSTIFICATIVA_TEXTO_TETO;
    }
    return limpo;
}

function justificativaEscapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function justificativaAllLabelsAlt() {
    return JUSTIFICATIVA_CAMPOS.flatMap((c) => c.labels).map(justificativaEscapeRe).join('|');
}

/** Prefixo opcional de lista markdown antes de um label (`-`, `*`, `•`, `1.` …). */
const JUSTIFICATIVA_PREFIXO_LISTA_REGEX = '(?:[-*•]\\s+|\\d+\\.\\s+)?';

function encontrarPrimeiroLabelJustificativa(texto) {
    const alt = justificativaAllLabelsAlt();
    const re = new RegExp(
        `(?:^|[\\n,]\\s*)${JUSTIFICATIVA_PREFIXO_LISTA_REGEX}(\\*?\\*?(?:${alt})\\*?\\*?)\\s*[:：]`,
        'i'
    );
    const m = re.exec(String(texto || ''));
    if (!m) return null;
    const labelPart = m[1];
    const labelOffsetInMatch = m[0].toLowerCase().lastIndexOf(labelPart.toLowerCase());
    return { index: m.index + Math.max(0, labelOffsetInMatch), length: labelPart.length };
}

function separarNomeECorpoJustificativa(raw) {
    const texto = String(raw || '').trim();
    if (!texto) return { nome: 'Critério', corpo: '' };
    const primeiro = encontrarPrimeiroLabelJustificativa(texto);
    if (primeiro && primeiro.index > 0) {
        const nome = stripMarkdownJustificativa(texto.slice(0, primeiro.index).replace(/[,\s]+$/, ''));
        const corpo = texto.slice(primeiro.index).replace(/^,\s*/, '');
        return { nome: nome || 'Critério', corpo };
    }
    const nl = texto.indexOf('\n');
    if (nl === -1) return { nome: stripMarkdownJustificativa(texto) || 'Critério', corpo: '' };
    return {
        nome: stripMarkdownJustificativa(texto.slice(0, nl)) || 'Critério',
        corpo: texto.slice(nl + 1)
    };
}

function extrairCampoJustificativa(bloco, labels) {
    const allLabels = justificativaAllLabelsAlt();
    const fonte = String(bloco || '');
    for (const label of labels) {
        const re = new RegExp(
            `(?:^|[\\n,]\\s*)${JUSTIFICATIVA_PREFIXO_LISTA_REGEX}\\*?\\*?${justificativaEscapeRe(label)}\\*?\\*?\\s*[:：]\\s*([\\s\\S]*?)(?=(?:[\\n,]\\s*${JUSTIFICATIVA_PREFIXO_LISTA_REGEX}\\*?\\*?(?:${allLabels})\\*?\\*?\\s*[:：])|$)`,
            'i'
        );
        const m = fonte.match(re);
        if (m) {
            const val = m[1].trim().replace(/,\s*$/, '').trim();
            if (val) return val;
        }
    }
    return null;
}

function parseJustificativaCriterios(markdownSecao) {
    if (!markdownSecao || typeof markdownSecao !== 'string') return [];
    const texto = markdownSecao.trim();
    if (!texto) return [];
    const comecaComH3 = /^###\s+/m.test(texto);
    const partes = texto.split(/^###\s+/m).filter((p) => p.trim());
    if (!comecaComH3 || partes.length === 0) {
        return [{ nome: 'Justificativa', campos: null, textoBruto: stripMarkdownJustificativa(texto), parcial: true }];
    }
    const blocos = [];
    for (const parte of partes) {
        const raw = parte.trim();
        if (!raw) continue;
        let { nome, corpo } = separarNomeECorpoJustificativa(raw);
        const fonteCampos = corpo || raw;
        const campos = {};
        let reconhecidos = 0;
        for (const { key, labels } of JUSTIFICATIVA_CAMPOS) {
            const val = extrairCampoJustificativa(fonteCampos, labels);
            if (val != null && String(val).trim()) {
                campos[key] = valorCampoFinalJustificativa(key, val);
                reconhecidos += 1;
            } else {
                campos[key] = null;
            }
        }
        const labNoNome = encontrarPrimeiroLabelJustificativa(nome);
        if (labNoNome && labNoNome.index > 0) {
            nome = stripMarkdownJustificativa(nome.slice(0, labNoNome.index).replace(/[,\s]+$/, ''));
        }
        if (reconhecidos === 0) {
            blocos.push({
                nome: nome || 'Critério',
                campos: null,
                textoBruto: stripMarkdownJustificativa(corpo || raw),
                parcial: true
            });
        } else {
            blocos.push({
                nome: nome || 'Critério',
                campos,
                textoBruto: stripMarkdownJustificativa(fonteCampos),
                parcial: reconhecidos < 3
            });
        }
    }
    return blocos.length
        ? blocos
        : [{ nome: 'Justificativa', campos: null, textoBruto: stripMarkdownJustificativa(texto), parcial: true }];
}

function renderJustificativaCriteriosCards(markdownSecao) {
    const itens = parseJustificativaCriterios(markdownSecao);
    if (!itens.length) return '';
    let html = '<div class="justificativa-criterios">';
    for (const item of itens) {
        html += `<div class="card mb-2 border-light shadow-sm"><div class="card-header py-2 bg-light">` +
            `<strong>${escapeHtmlChance(item.nome).replace(/<br>/g, ' ')}</strong></div><div class="card-body py-2">`;
        if (!item.campos) {
            const bruto = item.textoBruto || '';
            if (bruto && bruto !== item.nome) {
                html += `<p class="small mb-0">${escapeHtmlChance(bruto)}</p>`;
            } else if (!item.nome || item.nome === 'Critério' || item.nome === 'Justificativa') {
                html += `<p class="small mb-0">${escapeHtmlChance(bruto)}</p>`;
            }
        } else {
            const c = item.campos;
            if (c.classificacao || c.pontuacao) {
                html += '<p class="mb-2">';
                if (c.classificacao) {
                    html += `<span class="badge bg-secondary me-1">${escapeHtmlChance(c.classificacao).replace(/<br>/g, ' ')}</span>`;
                }
                if (c.pontuacao) {
                    html += `<span class="badge bg-primary">${escapeHtmlChance(c.pontuacao).replace(/<br>/g, ' ')}</span>`;
                }
                html += '</p>';
            }
            if (c.trechoReclamacao) {
                html += `<div class="mb-2"><div class="text-muted small fw-semibold">Trecho da reclamação</div>` +
                    `<blockquote class="border-start border-3 border-secondary ps-3 mb-0 small fst-italic">${escapeHtmlChance(c.trechoReclamacao)}</blockquote></div>`;
            }
            if (c.trechoResposta) {
                html += `<div class="mb-2"><div class="text-muted small fw-semibold">Trecho da resposta</div>` +
                    `<blockquote class="border-start border-3 border-secondary ps-3 mb-0 small fst-italic">${escapeHtmlChance(c.trechoResposta)}</blockquote></div>`;
            }
            if (c.justificativaTecnica) {
                html += `<div class="mb-2"><div class="fw-semibold small">Justificativa técnica</div><div class="small">${escapeHtmlChance(c.justificativaTecnica)}</div></div>`;
            }
            if (c.oQueReduziu) {
                html += `<div class="mb-2"><div class="fw-semibold small">O que reduziu a pontuação</div><div class="small">${escapeHtmlChance(c.oQueReduziu)}</div></div>`;
            }
            if (c.comoAumentar) {
                html += `<div class="mb-2"><div class="fw-semibold small">Como aumentar a pontuação</div><div class="small">${escapeHtmlChance(c.comoAumentar)}</div></div>`;
            }
        }
        html += '</div></div>';
    }
    html += '</div>';
    return html;
}

function renderCardMotorOficial(motor) {
    if (!motor) return '';
    const chance = motor.chance_final ?? motor.metadados?.chance_final;
    const faixa = String(motor.faixa_final ?? motor.metadados?.faixa_final ?? '').replace(/_/g, ' ');
    const detalhe = motor.detalhe_criterios || motor.metadados?.detalhe_criterios || {};
    let criteriosHtml = '';
    for (const [id, d] of Object.entries(detalhe)) {
        criteriosHtml += `<li class="small">${escapeHtmlChance(id)}: ${escapeHtmlChance(d.estado)} (${d.pontos} pts)</li>`;
    }
    return `<div class="card border-primary mb-3">
        <div class="card-header bg-primary text-white"><h6 class="mb-0"><i class="fas fa-calculator me-2"></i>Resultado Oficial do Motor</h6></div>
        <div class="card-body">
            <p class="mb-2"><strong>Chance:</strong> <span class="badge bg-primary fs-5">${chance}%</span></p>
            <p class="mb-2"><strong>Faixa:</strong> <span class="badge bg-info">${escapeHtmlChance(faixa)}</span></p>
            <ul class="mb-0">${criteriosHtml}</ul>
        </div>
    </div>`;
}

function renderCardComparativoMotor(comparacao, motorReformulado) {
    if (!comparacao?.executada) return '';
    const delta = comparacao.delta;
    const deltaClass = delta >= 0 ? 'text-success' : 'text-danger';
    return `<div class="card border-info mb-3">
        <div class="card-header bg-info text-white"><h6 class="mb-0"><i class="fas fa-balance-scale me-2"></i>Comparativo Motor #1 × #2</h6></div>
        <div class="card-body">
            <p class="mb-1">Original: <strong>${comparacao.original}%</strong> (${escapeHtmlChance(comparacao.faixaOriginal)})</p>
            <p class="mb-1">Reformulada: <strong>${comparacao.reformulada}%</strong> (${escapeHtmlChance(comparacao.faixaReformulada || '')})</p>
            <p class="mb-0 ${deltaClass}">Delta: <strong>${delta >= 0 ? '+' : ''}${delta} p.p.</strong></p>
        </div>
    </div>`;
}

function renderTabelaDeltaPorCriterio(deltaPorCriterio) {
    if (!deltaPorCriterio || !Object.keys(deltaPorCriterio).length) return '';
    let rows = '';
    for (const [id, item] of Object.entries(deltaPorCriterio)) {
        rows += `<tr>
            <td>${escapeHtmlChance(id)}</td>
            <td>${escapeHtmlChance(item.antes.estado)} (${item.antes.pontos})</td>
            <td>${escapeHtmlChance(item.depois.estado)} (${item.depois.pontos})</td>
            <td class="${item.deltaPontos >= 0 ? 'text-success' : 'text-danger'}">${item.deltaPontos >= 0 ? '+' : ''}${item.deltaPontos}</td>
        </tr>`;
    }
    return `<div class="card border-secondary mb-3">
        <div class="card-header"><h6 class="mb-0"><i class="fas fa-table me-2"></i>Delta por critério</h6></div>
        <div class="card-body p-0"><table class="table table-sm mb-0"><thead><tr><th>Critério</th><th>Motor #1</th><th>Motor #2</th><th>Delta</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}

function renderSecoesQualitativas(analise) {
    const secoes = parseSecoesChanceModeracao(analise);
    let html = '';
    for (const titulo of SECOES_CHANCE_MODERACAO) {
        if (titulo === 'Resultado Oficial do Motor') continue;
        const conteudo = secoes[titulo];
        if (!conteudo) continue;
        const corpo = titulo === 'Justificativa dos Critérios do Motor'
            ? renderJustificativaCriteriosCards(conteudo)
            : escapeHtmlChance(conteudo);
        html += `<div class="card mb-2"><div class="card-header py-2"><strong>${escapeHtmlChance(titulo)}</strong></div><div class="card-body py-2 small">${corpo}</div></div>`;
    }
    return html;
}

// Função para formatar a análise de chance de moderação (Motor-first, Fase 6)
function formatarAnaliseChanceModeracao(analise, extras = {}) {
    if (!analise) return '';

    const {
        motor,
        comparacao,
        deltaPorCriterio,
        reformulacaoAprovada,
        avisoRegressao,
        respostaReformulada
    } = extras;

    let html = '<div class="analise-chance-moderacao">';

    html += renderCardMotorOficial(motor);

    if (reformulacaoAprovada === false && avisoRegressao) {
        html += `<div class="alert alert-warning"><i class="fas fa-exclamation-triangle me-2"></i>${escapeHtmlChance(avisoRegressao)}</div>`;
    }

    html += renderCardComparativoMotor(comparacao, extras.motorReformulado);
    html += renderTabelaDeltaPorCriterio(deltaPorCriterio);
    html += renderSecoesQualitativas(analise);

    if (respostaReformulada && reformulacaoAprovada === false) {
        html += `<details class="mt-3"><summary class="fw-bold">Versão reformulada (auditoria)</summary><pre class="small mt-2 p-2 bg-light border">${escapeHtmlChance(respostaReformulada)}</pre></details>`;
    }

    const auditoriaInfo = extrairAuditoriaConsistencia(analise);
    if (auditoriaInfo.temAuditoria) {
        html += formatarAuditoriaConsistencia(auditoriaInfo);
    }

    html += '</div>';
    return html;
}

// Função para extrair informações da auditoria de consistência
function extrairAuditoriaConsistencia(analise) {
    if (!analise) return { temAuditoria: false };
    
    const resultado = {
        temAuditoria: false,
        semProblemas: false,
        problemas: []
    };
    
    // Procurar pelo bloco de auditoria
    const marcadoresAuditoria = [
        '🔍 Auditoria de Consistência da Resposta',
        'Auditoria de Consistência da Resposta',
        'AUDITORIA DE CONSISTÊNCIA'
    ];
    
    let marcadorAuditoria = -1;
    for (const marcador of marcadoresAuditoria) {
        const index = analise.indexOf(marcador);
        if (index !== -1) {
            marcadorAuditoria = index;
            break;
        }
    }
    
    if (marcadorAuditoria === -1) return resultado;
    
    resultado.temAuditoria = true;
    
    // Extrair o texto do bloco de auditoria
    let textoAuditoria = analise.substring(marcadorAuditoria);
    
    // Verificar se não há problemas
    if (textoAuditoria.includes('Nenhum ajuste pontual recomendado') || 
        textoAuditoria.includes('✅ Nenhum ajuste pontual recomendado')) {
        resultado.semProblemas = true;
        return resultado;
    }
    
    // Extrair problemas
    const regexProblema = /🔎\s*Problema\s*\d+:|🔎\s*Trecho identificado/gi;
    const problemas = textoAuditoria.split(regexProblema).filter(p => p.trim().length > 0);
    
    for (let i = 0; i < problemas.length; i++) {
        const problemaTexto = problemas[i];
        
        // Extrair trecho identificado
        const matchTrecho = problemaTexto.match(/Trecho identificado[:\s]*["']?([^"']+)["']?/i) ||
                            problemaTexto.match(/["']([^"']{20,200})["']/);
        const trecho = matchTrecho ? matchTrecho[1] : null;
        
        // Extrair justificativa
        const matchJustificativa = problemaTexto.match(/🧠\s*Justificativa[:\s]*([^✍🔎🧠]+)/is);
        let justificativa = matchJustificativa ? matchJustificativa[1].trim() : null;
        
        // Extrair sugestão de ajuste
        const matchSugestao = problemaTexto.match(/✍️\s*Sugestão de ajuste[:\s]*([^🔎🧠]+)/is);
        let sugestao = matchSugestao ? matchSugestao[1].trim() : null;
        
        if (trecho || justificativa || sugestao) {
            resultado.problemas.push({
                trecho: trecho || '',
                justificativa: justificativa || '',
                sugestao: sugestao || ''
            });
        }
    }
    
    return resultado;
}

// Função para formatar a auditoria de consistência na interface
function formatarAuditoriaConsistencia(auditoriaInfo) {
    let html = '<div class="card border-warning mt-4">';
    html += '<div class="card-header bg-warning text-dark">';
    html += '<h6 class="mb-0"><i class="fas fa-search me-2"></i>🔍 Auditoria de Consistência da Resposta</h6>';
    html += '</div>';
    html += '<div class="card-body">';
    
    if (auditoriaInfo.semProblemas) {
        html += '<div class="alert alert-success mb-0">';
        html += '<i class="fas fa-check-circle me-2"></i>';
        html += '<strong>✅ Nenhum ajuste pontual recomendado.</strong> A resposta reformulada está consistente com a tese principal de moderação.';
        html += '</div>';
    } else if (auditoriaInfo.problemas && auditoriaInfo.problemas.length > 0) {
        auditoriaInfo.problemas.forEach((problema, index) => {
            const problemaId = `problema-${index}`;
            html += `<div class="problema-auditoria mb-4 p-3 border rounded" id="${problemaId}">`;
            html += `<h6 class="text-warning"><i class="fas fa-exclamation-triangle me-2"></i>🔎 Problema ${index + 1}</h6>`;
            
            if (problema.trecho) {
                html += '<div class="mb-2">';
                html += '<strong>Trecho identificado:</strong>';
                html += `<div class="alert alert-light border mt-2 p-2"><code>${problema.trecho}</code></div>`;
                html += '</div>';
            }
            
            if (problema.justificativa) {
                html += '<div class="mb-2">';
                html += '<strong class="text-info">🧠 Justificativa:</strong>';
                html += `<p class="text-muted mt-1">${problema.justificativa}</p>`;
                html += '</div>';
            }
            
            if (problema.sugestao) {
                html += '<div class="mb-3">';
                html += '<strong class="text-success">✍️ Sugestão de ajuste:</strong>';
                html += `<div class="alert alert-success border mt-2 p-2"><code>${problema.sugestao}</code></div>`;
                html += '</div>';
            }
            
            // Botões de ação
            html += '<div class="btn-group" role="group">';
            html += `<button class="btn btn-sm btn-success" onclick="aplicarAjuste(${index}, '${problemaId.replace(/'/g, "\\'")}')">`;
            html += '<i class="fas fa-check me-1"></i> Aprovar e Aplicar';
            html += '</button>';
            html += `<button class="btn btn-sm btn-outline-secondary" onclick="rejeitarAjuste('${problemaId.replace(/'/g, "\\'")}')">`;
            html += '<i class="fas fa-times me-1"></i> Rejeitar';
            html += '</button>';
            html += `<button class="btn btn-sm btn-outline-primary" onclick="editarAjuste(${index}, '${problemaId.replace(/'/g, "\\'")}')">`;
            html += '<i class="fas fa-edit me-1"></i> Editar Sugestão';
            html += '</button>';
            html += '</div>';
            
            html += '</div>';
        });
    }
    
    html += '</div>';
    html += '</div>';
    
    return html;
}

// Função para aplicar ajuste aprovado
async function aplicarAjuste(problemaIndex, problemaId) {
    const problemaElement = document.getElementById(problemaId);
    if (!problemaElement) return;
    
    // Extrair informações do problema
    const trechoElement = problemaElement.querySelector('code');
    const sugestaoElement = problemaElement.querySelectorAll('code')[1];
    
    if (!trechoElement || !sugestaoElement) {
        showErrorMessage('Não foi possível extrair as informações do ajuste.');
        return;
    }
    
    const trechoOriginal = trechoElement.textContent.trim();
    const sugestaoAjuste = sugestaoElement.textContent.trim();
    
    // Obter a resposta revisada atual
    const respostaRevisada = window.respostaRevisadaModeracao || '';
    
    if (!respostaRevisada) {
        showErrorMessage('Resposta revisada não encontrada.');
        return;
    }
    
    showLoadingMessage('Aplicando ajuste...');
    
    try {
        const response = await fetch('/api/aplicar-ajuste', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                respostaOriginal: respostaRevisada,
                trechoOriginal: trechoOriginal,
                sugestaoAjuste: sugestaoAjuste
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Atualizar a resposta revisada
            window.respostaRevisadaModeracao = data.respostaAjustada;
            
            // Atualizar a resposta revisada na interface se estiver visível
            const respostaRevisadaElement = document.querySelector('#analise-chance-moderacao');
            if (respostaRevisadaElement) {
                // Atualizar o texto da revisão na interface
                const revisaoSection = respostaRevisadaElement.querySelector('h5:contains("Revisão de Textos")');
                if (revisaoSection) {
                    // Encontrar e atualizar o conteúdo da revisão
                    let conteudoAtual = respostaRevisadaElement.innerHTML;
                    const regexRevisao = /(✍️ Revisão de Textos[^<]*<\/h5>)([\s\S]*?)(?=<h5|🔍|$)/i;
                    const match = conteudoAtual.match(regexRevisao);
                    if (match) {
                        // Substituir apenas o conteúdo da revisão
                        const novoConteudo = match[1] + '<div class="mt-2 p-3 bg-light border rounded">' + 
                                           data.respostaAjustada.replace(/\n/g, '<br>') + '</div>';
                        conteudoAtual = conteudoAtual.replace(regexRevisao, novoConteudo);
                        respostaRevisadaElement.innerHTML = conteudoAtual;
                    }
                }
            }
            
            // Marcar problema como aplicado
            problemaElement.classList.add('border-success', 'bg-light');
            problemaElement.querySelector('.btn-group').innerHTML = 
                '<span class="badge bg-success"><i class="fas fa-check me-1"></i> Ajuste aplicado</span>';
            
            // Recalcular chance
            if (data.impactoAjuste) {
                mostrarImpactoAjuste(data.impactoAjuste);
            }
            
            showSuccessMessage('Ajuste aplicado com sucesso!');
        } else {
            showErrorMessage('Erro ao aplicar ajuste: ' + data.error);
        }
    } catch (error) {
        console.error('Erro ao aplicar ajuste:', error);
        showErrorMessage('Erro ao aplicar ajuste. Tente novamente.');
    }
}

// Função para rejeitar ajuste
function rejeitarAjuste(problemaId) {
    const problemaElement = document.getElementById(problemaId);
    if (!problemaElement) return;
    
    problemaElement.classList.add('border-secondary', 'bg-light', 'opacity-50');
    problemaElement.querySelector('.btn-group').innerHTML = 
        '<span class="badge bg-secondary"><i class="fas fa-times me-1"></i> Ajuste rejeitado</span>';
    
    showSuccessMessage('Ajuste rejeitado.');
}

// Função para editar sugestão de ajuste
function editarAjuste(problemaIndex, problemaId) {
    const problemaElement = document.getElementById(problemaId);
    if (!problemaElement) return;
    
    const sugestaoElement = problemaElement.querySelectorAll('code')[1];
    if (!sugestaoElement) return;
    
    const sugestaoAtual = sugestaoElement.textContent.trim();
    const novaSugestao = prompt('Edite a sugestão de ajuste:', sugestaoAtual);
    
    if (novaSugestao && novaSugestao !== sugestaoAtual) {
        sugestaoElement.textContent = novaSugestao;
        showSuccessMessage('Sugestão editada. Você pode aprovar o ajuste agora.');
    }
}

// Função para mostrar impacto do ajuste
function mostrarImpactoAjuste(impacto) {
    const html = `
        <div class="alert alert-info mt-3">
            <h6><i class="fas fa-chart-line me-2"></i>📊 Impacto do ajuste pontual na moderação</h6>
            <p class="mb-1"><strong>Chance antes do ajuste:</strong> <span class="badge bg-secondary">${impacto.antes}%</span></p>
            <p class="mb-1"><strong>Chance após o ajuste:</strong> <span class="badge bg-success">${impacto.depois}%</span></p>
            <p class="mb-0"><strong>Variação estimada:</strong> <span class="badge bg-primary">${impacto.variacao}</span></p>
        </div>
    `;
    
    // Adicionar após a última auditoria
    const auditoriaCard = document.querySelector('.card.border-warning');
    if (auditoriaCard) {
        auditoriaCard.insertAdjacentHTML('afterend', html);
    }
}

// Função para abrir modal de ajuste manual
function abrirModalAjusteManual() {
    if (!window.respostaRevisadaModeracao || !window.respostaRevisadaModeracao.trim()) {
        showErrorMessage('Nenhuma resposta revisada disponível para ajuste.');
        return;
    }
    
    // Preencher a resposta atual no modal
    document.getElementById('resposta-atual-ajuste').textContent = window.respostaRevisadaModeracao;
    
    // Limpar campo de instrução
    document.getElementById('instrucao-ajuste-manual').value = '';
    
    // Abrir modal usando Bootstrap
    const modal = new bootstrap.Modal(document.getElementById('modalAjusteManual'));
    modal.show();
}

// Função para executar ajuste manual
async function executarAjusteManual() {
    const instrucao = document.getElementById('instrucao-ajuste-manual').value.trim();
    
    if (!instrucao) {
        showErrorMessage('Por favor, descreva o ajuste desejado.');
        return;
    }
    
    if (!window.respostaRevisadaModeracao || !window.respostaRevisadaModeracao.trim()) {
        showErrorMessage('Nenhuma resposta revisada disponível.');
        return;
    }
    
    showLoadingMessage('Aplicando ajuste manual...');
    
    try {
        const response = await fetch('/api/ajuste-manual', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                respostaAtual: window.respostaRevisadaModeracao,
                instrucaoAjuste: instrucao
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Atualizar a resposta revisada
            window.respostaRevisadaModeracao = data.respostaAjustada;
            
            // Atualizar na interface
            atualizarRespostaRevisadaNaInterface(data.respostaAjustada);
            
            // Fechar modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('modalAjusteManual'));
            modal.hide();
            
            showSuccessMessage('Ajuste aplicado com sucesso!');
        } else {
            showErrorMessage('Erro ao aplicar ajuste: ' + data.error);
        }
        
    } catch (error) {
        console.error('Erro ao executar ajuste manual:', error);
        showErrorMessage('Erro ao executar ajuste manual. Tente novamente.');
    }
}

// Função para atualizar a resposta revisada na interface
function atualizarRespostaRevisadaNaInterface(novaResposta) {
    const analiseElement = document.getElementById('analise-chance-moderacao');
    if (!analiseElement) return;
    
    // Procurar pela seção de revisão de textos
    let conteudoAtual = analiseElement.innerHTML;
    
    // Encontrar e substituir o conteúdo da revisão
    const regexRevisao = /(✍️\s*Revisão de Textos[^<]*<\/h5>)([\s\S]*?)(?=<h5|🔍|📈|$)/i;
    const match = conteudoAtual.match(regexRevisao);
    
    if (match) {
        // Substituir apenas o conteúdo da revisão
        const novoConteudo = match[1] + 
            '<div class="mt-2 p-3 bg-light border rounded" style="white-space: pre-wrap;">' + 
            novaResposta.replace(/\n/g, '<br>') + 
            '</div>';
        conteudoAtual = conteudoAtual.replace(regexRevisao, novoConteudo);
        analiseElement.innerHTML = conteudoAtual;
    } else {
        // Se não encontrar, adicionar ao final
        analiseElement.innerHTML += 
            '<h5 class="text-dark mt-4 mb-3"><i class="fas fa-edit me-2"></i>✍️ Revisão de Textos (versão estratégica)</h5>' +
            '<div class="mt-2 p-3 bg-light border rounded" style="white-space: pre-wrap;">' + 
            novaResposta.replace(/\n/g, '<br>') + 
            '</div>';
    }
}


// ===== FUNÇÕES DE E-MAIL =====

async function gerarEmail() {
    const tipoEmail = document.getElementById('tipo-email').value;
    const destinatario = document.getElementById('destinatario').value;
    const contexto = document.getElementById('contexto-email').value;
    
    if (!tipoEmail) {
        showErrorMessage('Por favor, selecione o tipo de e-mail.');
        return;
    }
    
    if (!contexto || !contexto.trim()) {
        showErrorMessage('Por favor, preencha o campo Contexto com as informações relevantes.');
        return;
    }
    
    // Mostrar loading
    const btnGerar = document.querySelector('#emails-tool button.btn-dark');
    const btnOriginalText = btnGerar.innerHTML;
    btnGerar.disabled = true;
    btnGerar.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Gerando E-mail...';
    
    try {
        const response = await fetch('/api/generate-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tipoEmail: tipoEmail,
                destinatario: destinatario || '',
                contexto: contexto,
                userData: window.auth?.dadosUsuario ? {
                    nome: window.auth.dadosUsuario().nome,
                    email: window.auth.dadosUsuario().email,
                    genero: window.auth.dadosUsuario().genero
                } : null
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao gerar e-mail');
        }
        
        // Processar o e-mail retornado
        let emailFormatado = data.email;
        
        // Separar assunto do corpo se estiver no formato "ASSUNTO: ..."
        let assunto = '';
        let corpo = emailFormatado;
        
        if (emailFormatado.includes('ASSUNTO:')) {
            const partes = emailFormatado.split('ASSUNTO:');
            if (partes.length > 1) {
                assunto = partes[1].split('\n')[0].trim();
                corpo = partes.slice(1).join('ASSUNTO:').split('\n').slice(1).join('\n').trim();
            }
        }
        
        // Formatar o e-mail para exibição
        let emailHTML = '';
        if (assunto) {
            emailHTML += `<p><strong>Assunto:</strong> ${assunto}</p>`;
        }
        
        // Converter quebras de linha em parágrafos
        const paragrafos = corpo.split('\n\n').filter(p => p.trim());
        paragrafos.forEach(paragrafo => {
            const linhas = paragrafo.split('\n').filter(l => l.trim());
            if (linhas.length > 0) {
                emailHTML += `<p>${linhas.join('<br>')}</p>`;
            }
        });
        
        document.getElementById('email-content').innerHTML = emailHTML;
        document.getElementById('email-resultado').style.display = 'block';
        
        showSuccessMessage('E-mail gerado com sucesso!');
        
    } catch (error) {
        console.error('Erro ao gerar e-mail:', error);
        showErrorMessage(error.message || 'Erro ao gerar e-mail. Tente novamente.');
    } finally {
        btnGerar.disabled = false;
        btnGerar.innerHTML = btnOriginalText;
    }
}

// ===== RELATÓRIO DE RECLAMAÇÕES (RECLAME AQUI) =====

let ultimoRelatorioReclamacoes = null;
let ultimoDetalhamentoReclamacoes = null;

function inicializarRelatorioReclamacoesUI() {
    const ids = ['relatorio-horarios', 'relatorio-produtos', 'relatorio-motivos'];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', atualizarContagemRelatorioReclamacoes);
        el.addEventListener('paste', () => {
            setTimeout(atualizarContagemRelatorioReclamacoes, 0);
        });
    });
    atualizarContagemRelatorioReclamacoes();
}

function atualizarContagemRelatorioReclamacoes() {
    const horarios = parseLinhasRelatorio(document.getElementById('relatorio-horarios')?.value || '');
    const produtos = parseLinhasRelatorio(document.getElementById('relatorio-produtos')?.value || '');
    const motivos = parseLinhasRelatorio(document.getElementById('relatorio-motivos')?.value || '');

    const setCount = (id, n) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(n);
    };
    setCount('relatorio-count-horarios', horarios.length);
    setCount('relatorio-count-produtos', produtos.length);
    setCount('relatorio-count-motivos', motivos.length);

    const chipHor = document.getElementById('relatorio-chip-horarios');
    const chipProd = document.getElementById('relatorio-chip-produtos');
    const chipMot = document.getElementById('relatorio-chip-motivos');
    const msg = document.getElementById('relatorio-status-mensagem');
    const btnGerar = document.getElementById('btn-gerar-relatorio-reclamacoes');
    const btnDetalhamento = document.getElementById('btn-gerar-detalhamento-reclamacoes');
    const hint = document.getElementById('relatorio-gerar-hint');

    const total = horarios.length;
    const alinhado =
        total > 0 &&
        horarios.length === produtos.length &&
        horarios.length === motivos.length;
    const temAlgumDado = horarios.length > 0 || produtos.length > 0 || motivos.length > 0;

    [chipHor, chipProd, chipMot].forEach((chip) => {
        if (!chip) return;
        chip.classList.remove('chip-ok', 'chip-erro');
        if (!temAlgumDado) return;
        chip.classList.add(alinhado ? 'chip-ok' : 'chip-erro');
    });

    if (msg) {
        msg.classList.remove('status-ok', 'status-erro', 'status-neutro');
        if (!temAlgumDado) {
            msg.classList.add('status-neutro');
            msg.textContent = 'Cole os dados nas três colunas para ver a contagem.';
        } else if (alinhado) {
            msg.classList.add('status-ok');
            msg.innerHTML =
                '<i class="fas fa-check-circle me-1"></i>' +
                `${total} reclamação(ões) alinhada(s) — pronto para gerar o relatório.`;
        } else {
            msg.classList.add('status-erro');
            msg.innerHTML =
                '<i class="fas fa-exclamation-triangle me-1"></i>' +
                'As colunas Horários, Produtos e Motivos devem possuir a mesma quantidade de registros:<br>' +
                `Horários: ${horarios.length}<br>` +
                `Produtos: ${produtos.length}<br>` +
                `Motivos: ${motivos.length}`;
        }
    }

    if (btnGerar) btnGerar.disabled = !alinhado;
    if (btnDetalhamento) btnDetalhamento.disabled = !alinhado;
    if (hint) {
        hint.textContent = alinhado
            ? 'Relatório executivo (IA) ou detalhamento cronológico (instantâneo).'
            : temAlgumDado
              ? 'Ajuste as colunas até as contagens ficarem iguais.'
              : 'Alinhe as três colunas para habilitar a geração.';
    }
}

function parseLinhasRelatorio(texto) {
    if (!texto || typeof texto !== 'string') return [];
    return texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}

function validarColunasRelatorioReclamacoes() {
    const horarios = parseLinhasRelatorio(document.getElementById('relatorio-horarios')?.value || '');
    const produtos = parseLinhasRelatorio(document.getElementById('relatorio-produtos')?.value || '');
    const motivos = parseLinhasRelatorio(document.getElementById('relatorio-motivos')?.value || '');

    if (horarios.length !== produtos.length || horarios.length !== motivos.length) {
        showErrorMessage('As colunas Horários, Produtos e Motivos devem possuir a mesma quantidade de registros.');
        return null;
    }

    if (horarios.length === 0) {
        showErrorMessage('Informe ao menos um registro nas colunas Horários, Produtos e Motivos.');
        return null;
    }

    return { horarios, produtos, motivos };
}

function exibirRelatorioReclamacoes(texto) {
    const pre = document.getElementById('relatorio-reclamacoes-content');
    const resultado = document.getElementById('relatorio-reclamacoes-resultado');
    const refCorrecao = document.getElementById('relatorio-atual-correcao');

    if (pre) pre.textContent = texto;
    if (refCorrecao) refCorrecao.textContent = texto;
    if (resultado) resultado.style.display = 'block';

    ultimoRelatorioReclamacoes = texto;
}

function exibirDetalhamentoReclamacoes(texto) {
    const pre = document.getElementById('relatorio-detalhamento-content');
    const resultado = document.getElementById('relatorio-detalhamento-resultado');

    if (pre) pre.textContent = texto;
    if (resultado) resultado.style.display = 'block';

    ultimoDetalhamentoReclamacoes = texto;
}

function obterPayloadRelatorioReclamacoes() {
    return {
        horarios: document.getElementById('relatorio-horarios').value,
        produtos: document.getElementById('relatorio-produtos').value,
        motivos: document.getElementById('relatorio-motivos').value
    };
}

function abrirModalCorrecaoRelatorio() {
    if (!ultimoRelatorioReclamacoes) {
        showErrorMessage('Gere o relatório antes de aplicar correções.');
        return;
    }

    const refCorrecao = document.getElementById('relatorio-atual-correcao');
    const campoCorrecoes = document.getElementById('relatorio-correcoes');

    if (refCorrecao) refCorrecao.textContent = ultimoRelatorioReclamacoes;
    if (campoCorrecoes) campoCorrecoes.value = '';

    const modal = new bootstrap.Modal(document.getElementById('modalCorrecaoRelatorio'));
    modal.show();
}

async function gerarRelatorioReclamacoes() {
    const validacao = validarColunasRelatorioReclamacoes();
    if (!validacao) return;

    const btn = document.getElementById('btn-gerar-relatorio-reclamacoes');
    const btnOriginal = btn?.innerHTML;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Gerando relatório...';
    }

    try {
        const response = await fetch('/api/relatorio-reclamacoes/gerar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...obterPayloadRelatorioReclamacoes(),
                observacoes: document.getElementById('relatorio-observacoes')?.value || ''
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            const msg = data.error || 'Erro ao gerar relatório';
            if (data.detalhes && Array.isArray(data.detalhes)) {
                throw new Error(msg + '\n' + data.detalhes.join('\n'));
            }
            throw new Error(msg);
        }

        exibirRelatorioReclamacoes(data.relatorio);
        if (data.detalhamento) {
            exibirDetalhamentoReclamacoes(data.detalhamento);
        }
        showSuccessMessage('Relatório executivo gerado com sucesso!');
    } catch (error) {
        console.error('Erro ao gerar relatório de reclamações:', error);
        showErrorMessage(error.message || 'Erro ao gerar relatório. Tente novamente.');
    } finally {
        if (btn) {
            btn.innerHTML = btnOriginal;
        }
        atualizarContagemRelatorioReclamacoes();
    }
}

async function gerarDetalhamentoReclamacoes() {
    const validacao = validarColunasRelatorioReclamacoes();
    if (!validacao) return;

    const btn = document.getElementById('btn-gerar-detalhamento-reclamacoes');
    const btnOriginal = btn?.innerHTML;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Gerando...';
    }

    try {
        const response = await fetch('/api/relatorio-reclamacoes/detalhamento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(obterPayloadRelatorioReclamacoes())
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            const msg = data.error || 'Erro ao gerar detalhamento';
            if (data.detalhes && Array.isArray(data.detalhes)) {
                throw new Error(msg + '\n' + data.detalhes.join('\n'));
            }
            throw new Error(msg);
        }

        exibirDetalhamentoReclamacoes(data.detalhamento);
        showSuccessMessage('Detalhamento gerado com sucesso!');
    } catch (error) {
        console.error('Erro ao gerar detalhamento de reclamações:', error);
        showErrorMessage(error.message || 'Erro ao gerar detalhamento. Tente novamente.');
    } finally {
        if (btn) {
            btn.innerHTML = btnOriginal;
        }
        atualizarContagemRelatorioReclamacoes();
    }
}

async function aplicarCorrecoesRelatorioReclamacoes() {
    if (!ultimoRelatorioReclamacoes) {
        showErrorMessage('Gere o relatório antes de aplicar correções.');
        return;
    }

    const correcoes = document.getElementById('relatorio-correcoes')?.value?.trim();
    if (!correcoes) {
        showErrorMessage('Informe as instruções de correção desejadas.');
        return;
    }

    const btn = document.getElementById('btn-aplicar-correcao-relatorio');
    const btnOriginal = btn?.innerHTML;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Aplicando...';
    }

    try {
        const response = await fetch('/api/relatorio-reclamacoes/corrigir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                relatorioAtual: ultimoRelatorioReclamacoes,
                correcoes
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Erro ao aplicar correções');
        }

        exibirRelatorioReclamacoes(data.relatorio);

        const campoCorrecoes = document.getElementById('relatorio-correcoes');
        if (campoCorrecoes) campoCorrecoes.value = '';

        const modalEl = document.getElementById('modalCorrecaoRelatorio');
        const modalInstance = modalEl ? bootstrap.Modal.getInstance(modalEl) : null;
        if (modalInstance) modalInstance.hide();

        showSuccessMessage('Correções aplicadas com sucesso!');
    } catch (error) {
        console.error('Erro ao corrigir relatório:', error);
        showErrorMessage(error.message || 'Erro ao aplicar correções. Tente novamente.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = btnOriginal;
        }
    }
}

function copiarRelatorioReclamacoes() {
    const texto = document.getElementById('relatorio-reclamacoes-content')?.textContent || ultimoRelatorioReclamacoes;
    if (!texto) {
        showErrorMessage('Nenhum relatório para copiar.');
        return;
    }
    navigator.clipboard.writeText(texto).then(() => {
        showSuccessMessage('Relatório copiado para a área de transferência!');
    }).catch(() => {
        showErrorMessage('Erro ao copiar relatório.');
    });
}

function copiarDetalhamentoReclamacoes() {
    const texto = document.getElementById('relatorio-detalhamento-content')?.textContent || ultimoDetalhamentoReclamacoes;
    if (!texto) {
        showErrorMessage('Nenhum detalhamento para copiar.');
        return;
    }
    navigator.clipboard.writeText(texto).then(() => {
        showSuccessMessage('Detalhamento copiado para a área de transferência!');
    }).catch(() => {
        showErrorMessage('Erro ao copiar detalhamento.');
    });
}

// ===== FUNÇÕES AUXILIARES =====

function copiarResposta(elementId) {
    const element = document.getElementById(elementId);
    const text = element.innerText || element.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
        showSuccessMessage('Texto copiado para a área de transferência!');
    }).catch(() => {
        showErrorMessage('Erro ao copiar texto.');
    });
}

function copiarModeracao() {
    const linhaRaciocinio = document.getElementById('linha-raciocinio').innerText;
    const textoModeracao = document.getElementById('texto-moderacao').innerText;
    
    const textoCompleto = linhaRaciocinio + '\n\n' + textoModeracao;
    
    navigator.clipboard.writeText(textoCompleto).then(() => {
        showSuccessMessage('Solicitação de moderação copiada para a área de transferência!');
    }).catch(() => {
        showErrorMessage('Erro ao copiar texto.');
    });
}

// Função para gerar feedback de moderação
function gerarFeedbackModeracao() {
    const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
    const respostaEmpresa = document.getElementById('resposta-empresa').value;
    const motivoModeracao = document.getElementById('motivo-moderacao').value;
    
    if (!solicitacaoCliente || (typeof solicitacaoCliente === 'string' && !solicitacaoCliente.trim()) || !motivoModeracao) {
        showErrorMessage('Por favor, preencha a solicitação do cliente e selecione o motivo da moderação.');
        return;
    }
    
    // Gerar análise de feedback
    const feedback = gerarAnaliseFeedbackModeracao(solicitacaoCliente, respostaEmpresa, motivoModeracao);
    
    document.getElementById('feedback-conteudo').innerHTML = feedback;
    document.getElementById('feedback-moderacao').style.display = 'block';
    
    showSuccessMessage('Análise de feedback gerada com sucesso!');
}

// Função para gerar análise de feedback
function gerarAnaliseFeedbackModeracao(solicitacaoCliente, respostaEmpresa, motivoModeracao) {
    let feedback = '<p><strong>Análise de Feedback - Moderação RA</strong></p>';
    
    feedback += '<p><strong>Situação Analisada:</strong></p>';
    feedback += `<p>• Motivo da moderação: ${motivoModeracao}</p>`;
    feedback += `<p>• Solicitação do cliente: ${solicitacaoCliente.substring(0, 100)}...</p>`;
    
    if (respostaEmpresa && respostaEmpresa.trim()) {
        feedback += `<p>• Resposta da empresa: ${respostaEmpresa.substring(0, 100)}...</p>`;
    }
    
    feedback += '<p><strong>Análise:</strong></p>';
    
    switch (motivoModeracao) {
        case 'reclamacao-outra-empresa':
            feedback += `<p>✅ <strong>Moderação Justificada:</strong> A reclamação é direcionada a outra empresa, não à ${NOME_EMPRESA}. Recomenda-se solicitar a moderação para redirecionamento correto.</p>`;
            break;
        case 'reclamacao-trabalhista':
            feedback += '<p>✅ <strong>Moderação Justificada:</strong> Questão trabalhista não é de competência do Reclame Aqui. Recomenda-se solicitar a moderação.</p>';
            break;
        case 'conteudo-improprio':
            feedback += '<p>⚠️ <strong>Atenção:</strong> Verificar se o conteúdo realmente contém linguagem inadequada. Se confirmado, solicitar moderação.</p>';
            break;
        case 'reclamacao-duplicidade':
            feedback += '<p>✅ <strong>Moderação Justificada:</strong> Reclamação duplicada identificada. Recomenda-se solicitar a moderação para remoção.</p>';
            break;
        case 'reclamacao-terceiros':
            feedback += '<p>✅ <strong>Moderação Justificada:</strong> Reclamação feita por terceiros não autorizados. Recomenda-se solicitar a moderação.</p>';
            break;
        case 'caso-fraude':
            feedback += '<p>✅ <strong>Moderação Justificada:</strong> Caso comprovado de fraude. Recomenda-se solicitar a moderação imediatamente.</p>';
            break;
        case 'nao-violou-direito':
            feedback += '<p>⚠️ <strong>Análise Necessária:</strong> Verificar se realmente não houve violação de direitos. Se confirmado, solicitar moderação.</p>';
            break;
        default:
            feedback += '<p>❓ <strong>Análise Necessária:</strong> Motivo de moderação não identificado. Revisar a situação antes de solicitar moderação.</p>';
    }
    
    feedback += '<p><strong>Recomendação:</strong></p>';
    feedback += '<p>• Documentar todos os fatos e evidências</p>';
    feedback += '<p>• Preparar justificativa clara para a moderação</p>';
    feedback += '<p>• Manter registro da solicitação para acompanhamento</p>';
    
    return feedback;
}

// Função para avaliar moderação
async function avaliarModeracao(tipoAvaliacao) {
    console.log('🎯 Função avaliarModeracao chamada com tipo:', tipoAvaliacao);
    
    const linhaRaciocinio = document.getElementById('linha-raciocinio').innerText;
    const textoModeracao = document.getElementById('texto-moderacao').innerText;
    
    console.log('📝 Conteúdo capturado:', {
        linhaRaciocinio: linhaRaciocinio ? 'OK' : 'VAZIO',
        textoModeracao: textoModeracao ? 'OK' : 'VAZIO'
    });
    
    if (!linhaRaciocinio.trim() || !textoModeracao.trim()) {
        showErrorMessage('Não há solicitação de moderação para avaliar.');
        return;
    }
    
    if (tipoAvaliacao === 'coerente') {
        console.log('✅ Marcando como coerente - chamando salvarModeracaoComoModelo()');

        // Só checa duplicidade quando NÃO é uma reformulação de verdade (essa sempre tem o
        // vínculo com a tentativa anterior) — reformulação salvar de novo pro mesmo ID é esperado.
        if (!window._moderacaoIdAnterior) {
            const idReclamacaoAtual = document.getElementById('id-reclamacao-moderacao').value.trim();
            const podeSalvar = await confirmarSalvarComDuplicidade(idReclamacaoAtual, 'moderacoes', 'moderação');
            if (!podeSalvar) {
                showErrorMessage('Salvamento cancelado.');
                return;
            }
        }

        // Marcar como aprovada e salvar como modelo
        await salvarModeracaoComoModelo();
        
        // Atualizar estatísticas globais após salvar
        carregarEstatisticasGlobais();
        
    } else if (tipoAvaliacao === 'incoerente') {
        console.log('❌ Marcando como incoerente - chamando solicitarFeedbackModeracao()');
        // Solicitar feedback para reformulação
        solicitarFeedbackModeracao();
    }
}

// Função para salvar moderação como modelo
async function salvarModeracaoComoModelo() {
    console.log('🚀 FUNÇÃO salvarModeracaoComoModelo INICIADA!');
    try {
        console.log('🎯 Iniciando salvamento de moderação como modelo...');
        
        // Obter dados da moderação atual
        const idReclamacao = document.getElementById('id-reclamacao-moderacao').value.trim();
        const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
        const respostaEmpresa = document.getElementById('resposta-empresa').value;
        const motivoModeracao = document.getElementById('motivo-moderacao').value;
        const consideracaoFinal = (document.getElementById('consideracao-final-moderacao') || {}).value || '';
        
        const linhaRaciocinio = document.getElementById('linha-raciocinio').innerText;
        const textoModeracao = document.getElementById('texto-moderacao').innerText;
        const elAuditoriaHipotese = document.getElementById('auditoria-hipotese');
        const auditoriaHipotese = elAuditoriaHipotese ? elAuditoriaHipotese.innerText.trim() : '';
        
        // Validar ID da reclamação
        if (!idReclamacao) {
            showErrorMessage('ID da Reclamação é obrigatório para salvar como modelo.');
            return;
        }
        
        console.log('🔍 Elementos encontrados:', {
            linhaRaciocinioElement: document.getElementById('linha-raciocinio') ? 'OK' : 'NÃO ENCONTRADO',
            textoModeracaoElement: document.getElementById('texto-moderacao') ? 'OK' : 'NÃO ENCONTRADO',
            consideracaoFinalModeracao: document.getElementById('consideracao-final-moderacao') ? 'OK' : 'NÃO ENCONTRADO'
        });
        
        console.log('📝 Dados capturados:', {
            solicitacaoCliente: solicitacaoCliente ? 'OK' : 'VAZIO',
            respostaEmpresa: respostaEmpresa ? 'OK' : 'VAZIO',
            motivoModeracao: motivoModeracao ? 'OK' : 'VAZIO',
            consideracaoFinal: consideracaoFinal ? 'OK' : '(vazio/opcional)',
            linhaRaciocinio: linhaRaciocinio ? 'OK' : 'VAZIO',
            textoModeracao: textoModeracao ? 'OK' : 'VAZIO'
        });
        
        // Consideração final é opcional; obrigatórios: solicitação, resposta da empresa e motivo
        if (!solicitacaoCliente || !respostaEmpresa || !motivoModeracao) {
            console.error('❌ Dados incompletos:', {
                solicitacaoCliente: solicitacaoCliente ? 'OK' : 'VAZIO',
                respostaEmpresa: respostaEmpresa ? 'OK' : 'VAZIO',
                motivoModeracao: motivoModeracao ? 'OK' : 'VAZIO',
                consideracaoFinal: consideracaoFinal ? 'OK' : '(opcional)'
            });
            showErrorMessage('Preencha Solicitação do Cliente, Resposta da Empresa e Motivo da Moderação para salvar como modelo.');
            return;
        }
        
        // Mostrar loading
        showLoadingMessage('Salvando moderação como modelo...');
        
        // Chamar endpoint para salvar modelo
        console.log('🚀 Enviando dados para o servidor...');
        const response = await fetch('/api/save-modelo-moderacao', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                idReclamacao: idReclamacao,
                dadosModeracao: {
                    solicitacaoCliente: solicitacaoCliente,
                    respostaEmpresa: respostaEmpresa,
                    motivoModeracao: motivoModeracao,
                    consideracaoFinal: consideracaoFinal
                },
                linhaRaciocinio: linhaRaciocinio,
                auditoriaHipotese: auditoriaHipotese,
                textoModeracao: textoModeracao,
                // Presente quando este texto veio de "Carregar pra Reformular": encadeia como 2ª+ tentativa
                // da mesma reclamação em vez de contar como uma moderação nova e desconectada.
                idModeracaoAnterior: window._moderacaoIdAnterior || undefined
            })
        });

        console.log('📡 Resposta do servidor:', response.status, response.statusText);

        const data = await response.json();

        if (data.success) {
            const eraReformulacao = !!window._moderacaoIdAnterior;
            showSuccessMessage(eraReformulacao
                ? `✅ Reformulação salva como coerente (${data.numeroTentativa}ª tentativa)! Veja em "Todas as Solicitações" pra registrar o resultado quando o RA responder.`
                : '✅ Moderação salva como modelo para futuras solicitações!');
            console.log('📝 Modelo de moderação salvo:', data.modelo, 'numeroTentativa:', data.numeroTentativa);
            // Limpar o encadeamento após o uso, pra não grudar numa próxima moderação sem relação.
            window._moderacaoIdAnterior = null;
        } else {
            showErrorMessage('Erro ao salvar modelo: ' + data.error);
        }
        
    } catch (error) {
        console.error('❌ Erro ao salvar modelo de moderação:', error);
        showErrorMessage('Erro ao salvar modelo de moderação.');
    }
}

// Função para solicitar feedback de moderação
function solicitarFeedbackModeracao() {
    const modalHtml = `
        <div class="modal fade" id="feedbackModalModeracao" tabindex="-1" aria-labelledby="feedbackModalModeracaoLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="feedbackModalModeracaoLabel">
                            <i class="fas fa-comment-dots me-2"></i>
                            Feedback para Reformulação
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="feedback-moderacao-text" class="form-label">
                                <strong>Por que a solicitação está incoerente?</strong>
                            </label>
                            <p class="text-muted small">Descreva o que está errado para que o sistema aprenda e melhore futuras solicitações.</p>
                            <textarea class="form-control" id="feedback-moderacao-text" rows="4" 
                                placeholder="Ex: Motivo inadequado, falta de clareza, informações incorretas..."></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            <i class="fas fa-times me-2"></i>
                            Cancelar
                        </button>
                        <button type="button" class="btn btn-warning" onclick="processarFeedbackModeracao()">
                            <i class="fas fa-redo me-2"></i>
                            Reformular com Feedback
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remover modal anterior se existir
    const modalAnterior = document.getElementById('feedbackModalModeracao');
    if (modalAnterior) {
        modalAnterior.remove();
    }
    
    // Adicionar modal ao body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('feedbackModalModeracao'));
    modal.show();
}

// Função para processar feedback de moderação
async function processarFeedbackModeracao() {
    const feedbackText = document.getElementById('feedback-moderacao-text').value.trim();
    
    if (!feedbackText) {
        showErrorMessage('Por favor, forneça um feedback para a reformulação.');
        return;
    }
    
    // Fechar modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('feedbackModalModeracao'));
    modal.hide();
    
    // Mostrar loading
    showLoadingMessage('Reformulando solicitação de moderação com base no feedback...');
    
    try {
        // Gerar nova solicitação com base no feedback
        const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
        const respostaEmpresa = document.getElementById('resposta-empresa').value;
        const motivoModeracao = document.getElementById('motivo-moderacao').value;
        const consideracaoFinal = (document.getElementById('consideracao-final-moderacao') || {}).value || '';
        
        // Chamar o endpoint do servidor para reformulação
        const response = await fetch('/api/reformulate-moderation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                textoNegado: document.getElementById('texto-moderacao').innerText,
                motivoNegativa: feedbackText,
                dadosModeracao: {
                    solicitacaoCliente: solicitacaoCliente,
                    respostaEmpresa: respostaEmpresa,
                    motivoModeracao: motivoModeracao,
                    consideracaoFinal: consideracaoFinal
                }
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Processar a resposta reformulada
            const resposta = data.result;
            
            // Para reformulação, o servidor retorna apenas o texto reformulado
            const textoFormatado = formatarTextoModeracao(resposta);
            const textoModeracaoReformulado = `<div class="moderacao-texto reformulado">${textoFormatado}</div>`;
            
            // Gerar linha de raciocínio reformulada local
            const linhaRaciocinioReformulada = gerarLinhaRaciocinioModeracaoReformulada(motivoModeracao, solicitacaoCliente, respostaEmpresa, feedbackText);
            
            // Atualizar interface
            document.getElementById('linha-raciocinio').innerHTML = linhaRaciocinioReformulada;
            document.getElementById('texto-moderacao').innerHTML = textoModeracaoReformulado;
            
            showSuccessMessage('Solicitação de moderação reformulada com script estruturado!');
        } else {
            throw new Error(data.error || 'Erro ao reformular moderação');
        }
    } catch (error) {
        console.error('Erro ao reformular moderação:', error);
        showErrorMessage('Erro ao reformular moderação. Usando modelo local como fallback.');
        
        // Fallback para o modelo local
        const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
        const respostaEmpresa = document.getElementById('resposta-empresa').value;
        const motivoModeracao = document.getElementById('motivo-moderacao').value;
        const consideracaoFinal = (document.getElementById('consideracao-final-moderacao') || {}).value || '';
        
        const linhaRaciocinioReformulada = gerarLinhaRaciocinioModeracaoReformulada(motivoModeracao, solicitacaoCliente, respostaEmpresa, feedbackText);
        const textoModeracaoReformulado = gerarTextoModeracaoReformulado(motivoModeracao, consideracaoFinal, feedbackText);
        
        document.getElementById('linha-raciocinio').innerHTML = linhaRaciocinioReformulada;
        document.getElementById('texto-moderacao').innerHTML = textoModeracaoReformulado;
        
        showSuccessMessage('Solicitação de moderação reformulada (modelo local)!');
    }
}

// Função para gerar linha de raciocínio reformulada
function gerarLinhaRaciocinioModeracaoReformulada(motivoModeracao, solicitacaoCliente, respostaEmpresa, feedback) {
    let linha = '<div class="linha-raciocinio reformulada">';
    linha += '<h6 class="text-warning mb-3"><i class="fas fa-redo me-2"></i>Linha de Raciocínio Interna (Reformulada):</h6>';
    
    linha += '<div class="alert alert-warning border-start border-warning border-4 mb-3">';
    linha += '<p class="mb-2"><strong>Análise da Reformulação:</strong></p>';
    linha += '<p class="mb-0">Com base no feedback fornecido, a reformulação foi realizada considerando os pontos identificados.</p>';
    linha += '</div>';
    
    linha += '<div class="card mb-3">';
    linha += '<div class="card-header bg-danger text-white">';
    linha += '<h6 class="mb-0"><i class="fas fa-comment-dots me-2"></i>Feedback Recebido</h6>';
    linha += '</div>';
    linha += '<div class="card-body">';
    linha += `<p class="mb-0">${feedback}</p>`;
    linha += '</div>';
    linha += '</div>';
    
    linha += '<div class="card mb-3">';
    linha += '<div class="card-header bg-success text-white">';
    linha += '<h6 class="mb-0"><i class="fas fa-check-circle me-2"></i>Ajustes Realizados</h6>';
    linha += '</div>';
    linha += '<div class="card-body">';
    linha += '<ul class="mb-0">';
    linha += '<li>Corrigir os pontos identificados no feedback</li>';
    linha += '<li>Manter a estrutura técnica e formal</li>';
    linha += '<li>Seguir as diretrizes dos manuais do RA</li>';
    linha += '<li>Garantir aderência aos padrões de moderação</li>';
    linha += '</ul>';
    linha += '</div>';
    linha += '</div>';
    
    if (solicitacaoCliente && typeof solicitacaoCliente === 'string' && solicitacaoCliente.trim()) {
        linha += '<div class="mb-3">';
        linha += '<h6 class="text-secondary"><i class="fas fa-user me-2"></i>Solicitação do Cliente:</h6>';
        linha += `<div class="bg-light p-3 rounded border-start border-secondary border-4">`;
        linha += `<p class="mb-0">${solicitacaoCliente}</p>`;
        linha += '</div>';
        linha += '</div>';
    }
    
    if (respostaEmpresa && respostaEmpresa.trim()) {
        linha += '<div class="mb-3">';
        linha += '<h6 class="text-success"><i class="fas fa-building me-2"></i>Resposta da Empresa:</h6>';
        linha += `<div class="bg-light p-3 rounded border-start border-success border-4">`;
        linha += `<p class="mb-0">${respostaEmpresa}</p>`;
        linha += '</div>';
        linha += '</div>';
    }
    
    linha += '</div>';
    return linha;
}

// Função para gerar texto de moderação reformulado
function gerarTextoModeracaoReformulado(motivoModeracao, consideracaoFinal, feedback) {
    let texto = '<p><strong>Texto para Moderação (Reformulado):</strong></p>';
    
    texto += '<p>Prezados,</p>';
    texto += '<p>Solicitamos a moderação do conteúdo acima pelos seguintes motivos:</p>';
    
    const motivos = {
        'reclamacao-outra-empresa': `A reclamação é direcionada a outra empresa, não à ${NOME_EMPRESA}.`,
        'reclamacao-trabalhista': 'Trata-se de questão trabalhista, não de relação de consumo.',
        'conteudo-improprio': 'O conteúdo contém linguagem inadequada ou ofensiva.',
        'reclamacao-duplicidade': 'Esta é uma reclamação duplicada já registrada anteriormente.',
        'reclamacao-terceiros': 'A reclamação é feita por terceiros não autorizados.',
        'caso-fraude': 'Este é um caso comprovado de fraude.',
        'nao-violou-direito': 'A empresa não violou o direito do consumidor.'
    };
    
    texto += '<p>' + (motivos[motivoModeracao] || 'Violação às regras da plataforma.') + '</p>';
    
    if (consideracaoFinal && consideracaoFinal.trim()) {
        texto += '<p><strong>Consideração Final:</strong></p>';
        texto += `<p>${consideracaoFinal}</p>`;
    }
    
    texto += '<p><strong>Observação:</strong> Esta solicitação foi reformulada com base em feedback interno para maior clareza e precisão.</p>';
    
    texto += '<p>Agradecemos a atenção.</p>';
    
    return texto;
}

function updateStats() {
    document.querySelectorAll('.stat-value')[0].textContent = stats.respostasHoje;
    document.querySelectorAll('.stat-value')[1].textContent = stats.moderacoes;
}

// Sincronizar estatísticas com Google Sheets
async function sincronizarEstatisticasComPlanilha() {
    try {
        console.log('🔄 Sincronizando estatísticas com Google Sheets...');
        const response = await fetch('/api/sync-estatisticas', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Estatísticas sincronizadas com Google Sheets:', data.estatisticas);
            showSuccessMessage('Estatísticas sincronizadas com a planilha!');
        } else {
            // Não mostrar toast de erro quando Sheets está indisponível (evita alarmar o usuário)
            const msg = (data.message || data.error || '').toLowerCase();
            if (msg.includes('indisponível') || msg.includes('não está ativo') || data.googleSheetsActive === false) {
                console.log('📊 Sincronização com planilha indisponível:', data.message || data.error);
            } else {
                console.error('❌ Erro ao sincronizar estatísticas:', data.error);
                showErrorMessage('Erro ao sincronizar estatísticas: ' + (data.message || data.error));
            }
        }
    } catch (error) {
        // Não mostrar toast em falha de rede/500 - apenas log
        console.warn('⚠️ Sincronizar estatísticas:', error.message);
    }
}

// Inicializar sistema de histórico
function inicializarHistorico() {
    // Carregar apenas estatísticas globais do servidor
    carregarEstatisticasGlobais();
    
    // Sincronizar com Google Sheets após 3 segundos
    setTimeout(() => {
        sincronizarEstatisticasComPlanilha();
    }, 3000);
}

// ===== MODAL DE SOLICITAÇÕES =====

// Abrir modal de solicitações
function abrirModalSolicitacoes() {
    const modal = new bootstrap.Modal(document.getElementById('modalSolicitacoes'));
    modal.show();
    
    // Definir data padrão (últimos 30 dias)
    const hoje = new Date();
    const dataFim = hoje.toISOString().split('T')[0];
    const dataInicio = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    document.getElementById('filtroDataInicio').value = dataInicio;
    document.getElementById('filtroDataFim').value = dataFim;
    document.getElementById('filtroTipo').value = 'todas';
    
    // Buscar solicitações automaticamente
    buscarSolicitacoes();
}

// Buscar solicitações da planilha
// Cache das últimas solicitações buscadas no modal "Todas as Solicitações", indexado por
// solicitacaoId — usado por carregarModeracaoParaReformular() pra recuperar o objeto completo
// sem precisar serializar tudo dentro do onclick do botão.
let solicitacoesCache = {};

async function buscarSolicitacoes() {
    const dataInicio = document.getElementById('filtroDataInicio').value;
    const dataFim = document.getElementById('filtroDataFim').value;
    const idReclamacao = (document.getElementById('filtroIdReclamacaoModal').value || '').trim();
    const tipo = document.getElementById('filtroTipo').value;
    
    const tabela = document.getElementById('tabelaSolicitacoes');
    const infoDiv = document.getElementById('infoSolicitacoes');
    const textoInfo = document.getElementById('textoInfoSolicitacoes');
    
    // Mostrar loading
    tabela.innerHTML = `
        <tr>
            <td colspan="5" class="text-center text-muted">
                <i class="fas fa-spinner fa-spin me-2"></i>
                Buscando solicitações...
            </td>
        </tr>
    `;
    infoDiv.style.display = 'none';
    
    try {
        // Construir URL com parâmetros (idReclamacao filtra nas 4 fontes: Respostas Coerentes, Moderação, Aceitas, Negadas)
        const params = new URLSearchParams();
        if (dataInicio) params.append('dataInicio', dataInicio);
        if (dataFim) params.append('dataFim', dataFim);
        if (idReclamacao) params.append('idReclamacao', idReclamacao);
        if (tipo) params.append('tipo', tipo);
        
        const response = await fetch(`/api/solicitacoes?${params.toString()}`);
        const data = await response.json();
        
        if (data.success) {
            const solicitacoes = data.solicitacoes || [];
            
            // Atualizar informação
            textoInfo.textContent = `Total de ${solicitacoes.length} solicitação(ões) encontrada(s)`;
            infoDiv.style.display = 'block';
            
            if (solicitacoes.length === 0) {
                tabela.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center text-muted">
                            <i class="fas fa-inbox me-2"></i>
                            Nenhuma solicitação encontrada para o período selecionado.
                        </td>
                    </tr>
                `;
            } else {
                // Preencher tabela com estrutura expansível.
                // Moderações da MESMA reclamação (idReclamacao) são agrupadas em 1 card só —
                // 1ª tentativa (negada) e 2ª+ tentativa (reformulação) ficam juntas, deixando visível
                // que é a mesma reclamação em tentativas diferentes (ver [[project-negativa-real-feature]]).
                solicitacoesCache = {};

                // Gera o bloco de detalhes (acordeão de campos brutos + resultado/ações) de UMA
                // tentativa de moderação — reaproveitado tanto sozinho (reclamação com 1 tentativa)
                // quanto empilhado dentro de um card de grupo (reclamação com 2+ tentativas).
                const renderDetalhesModeracao = (solicitacao, solicitacaoId, options) => {
                    const permitirReformular = options && options.permitirReformular;
                    return `
                        <div class="accordion mb-3" id="acc-mod-${solicitacaoId}">
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#acc-texto-${solicitacaoId}">
                                        <i class="fas fa-file-alt me-2"></i>Texto de Moderação
                                    </button>
                                </h2>
                                <div id="acc-texto-${solicitacaoId}" class="accordion-collapse collapse">
                                    <div class="accordion-body" style="white-space: pre-wrap;">${solicitacao.textoModeracao || 'N/A'}</div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#acc-resposta-${solicitacaoId}">
                                        <i class="fas fa-building me-2"></i>Resposta da Empresa
                                    </button>
                                </h2>
                                <div id="acc-resposta-${solicitacaoId}" class="accordion-collapse collapse">
                                    <div class="accordion-body" style="white-space: pre-wrap;">${solicitacao.respostaEmpresa || 'N/A'}</div>
                                </div>
                            </div>
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#acc-motivo-${solicitacaoId}">
                                        Motivo da Moderação
                                    </button>
                                </h2>
                                <div id="acc-motivo-${solicitacaoId}" class="accordion-collapse collapse">
                                    <div class="accordion-body">${solicitacao.motivoModeracao || 'N/A'}</div>
                                </div>
                            </div>
                            ${solicitacao.consideracaoFinal ? `
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#acc-consideracao-${solicitacaoId}">
                                        Consideração Final
                                    </button>
                                </h2>
                                <div id="acc-consideracao-${solicitacaoId}" class="accordion-collapse collapse">
                                    <div class="accordion-body" style="white-space: pre-wrap;">${solicitacao.consideracaoFinal}</div>
                                </div>
                            </div>
                            ` : ''}
                            ${solicitacao.linhaRaciocinio ? `
                            <div class="accordion-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#acc-linha-${solicitacaoId}">
                                        Linha de Raciocínio
                                    </button>
                                </h2>
                                <div id="acc-linha-${solicitacaoId}" class="accordion-collapse collapse">
                                    <div class="accordion-body" style="white-space: pre-wrap;">${solicitacao.linhaRaciocinio}</div>
                                </div>
                            </div>
                            ` : ''}
                        </div>
                        <div class="campo-detalhe" style="background-color: #f8f9fa; padding: 20px; border-left: 4px solid #0d6efd; margin-top: 20px;">
                            <div class="campo-label" style="font-size: 1.1rem; color: #0d6efd; margin-bottom: 15px;">
                                <i class="fas fa-clipboard-check me-2"></i>Resultado da Moderação:
                            </div>
                            ${solicitacao.resultadoModeracao && (solicitacao.resultadoModeracao === 'Aceita' || solicitacao.resultadoModeracao === 'Negada') ? `
                                <div class="alert ${solicitacao.resultadoModeracao === 'Aceita' ? 'alert-success' : 'alert-danger'}" style="margin-bottom: 15px;">
                                    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                                        <div>
                                            <strong>Status:</strong> ${solicitacao.resultadoModeracao === 'Aceita' ? '✅ Moderação Aceita' : '❌ Moderação Negada'}
                                        </div>
                                        ${solicitacao.resultadoModeracao === 'Negada' ? `
                                            <button class="btn btn-sm btn-warning" onclick="verAnaliseCompletaNegada('${String(solicitacao.id || '').replace(/'/g, "\\'")}')" title="Abre a análise completa com IA sobre por que essa negativa aconteceu">
                                                <i class="fas fa-search me-1"></i>
                                                Ver Análise Completa
                                            </button>
                                        ` : ''}
                                    </div>
                                </div>
                            ` : `
                                <div class="alert alert-warning" style="margin-bottom: 15px;">
                                    <i class="fas fa-exclamation-triangle me-2"></i>
                                    <strong>Nenhum resultado registrado.</strong> Por favor, registre o resultado final da moderação no Reclame Aqui.
                                </div>
                            `}
                            <div class="d-flex gap-2 flex-wrap">
                                <button class="btn btn-success" onclick="registrarResultadoModeracao('${String(solicitacao.id || '').replace(/'/g, "\\'")}', 'Aceita', '${solicitacaoId}')" ${(solicitacao.resultadoModeracao === 'Aceita' || solicitacao.resultadoModeracao === 'Negada') ? 'disabled' : ''}>
                                    <i class="fas fa-check-circle me-2"></i>
                                    Moderação Aceita
                                </button>
                                <button class="btn btn-danger" onclick="registrarResultadoModeracao('${String(solicitacao.id || '').replace(/'/g, "\\'")}', 'Negada', '${solicitacaoId}')" ${(solicitacao.resultadoModeracao === 'Aceita' || solicitacao.resultadoModeracao === 'Negada') ? 'disabled' : ''}>
                                    <i class="fas fa-times-circle me-2"></i>
                                    Moderação Negada
                                </button>
                                ${(solicitacao.resultadoModeracao === 'Aceita' || solicitacao.resultadoModeracao === 'Negada') ? `
                                <button class="btn btn-warning btn-sm" onclick="limparResultadoModeracao('${String(solicitacao.id || '').replace(/'/g, "\\'")}', '${solicitacaoId}')" title="Limpar resultado para testar novamente">
                                    <i class="fas fa-undo me-2"></i>
                                    Limpar Resultado
                                </button>
                                ` : ''}
                                ${(permitirReformular && solicitacao.resultadoModeracao !== 'Aceita') ? `
                                <button class="btn btn-outline-danger btn-sm" onclick="carregarModeracaoParaReformular('${solicitacaoId}')" title="Traz essa moderação de volta pro formulário principal para reformular">
                                    <i class="fas fa-file-import me-2"></i>
                                    Carregar pra Reformular
                                </button>
                                ` : ''}
                            </div>
                        </div>
                    `;
                };

                const respostas = solicitacoes.filter(s => s.tipo === 'resposta');
                const moderacoes = solicitacoes.filter(s => s.tipo === 'moderacao');

                // Agrupar moderações por ID da Reclamação (ID do RA) e ordenar tentativas dentro do
                // grupo pela coluna Q ("Número da Tentativa"; fallback pra data em registros antigos
                // sem essa coluna, onde tudo cai como 1ª tentativa).
                const gruposModeracaoMap = new Map();
                moderacoes.forEach((solicitacao, index) => {
                    const chave = (solicitacao.idReclamacao || `sem-id-${index}`).toString().trim();
                    if (!gruposModeracaoMap.has(chave)) gruposModeracaoMap.set(chave, []);
                    gruposModeracaoMap.get(chave).push(solicitacao);
                });
                const gruposModeracao = Array.from(gruposModeracaoMap.entries()).map(([idReclamacao, itens]) => {
                    itens.sort((a, b) => (a.numeroTentativa || 1) - (b.numeroTentativa || 1));
                    return { idReclamacao, itens };
                });

                // Resumo curto pra coluna "Detalhes" — trunca com reticências só quando corta de fato.
                const truncar = (texto, tamanho) => {
                    const t = (texto || '').toString().trim();
                    return t.length > tamanho ? `${t.substring(0, tamanho)}...` : t;
                };

                const linhasResposta = respostas.map((solicitacao, index) => {
                    const solicitacaoId = `solicitacao-${solicitacao.tipo}-${solicitacao.id || index}`;
                    solicitacoesCache[solicitacaoId] = solicitacao;
                    const tipoBadge = solicitacao.tipo === 'resposta'
                        ? '<span class="badge bg-success">Resposta</span>'
                        : '<span class="badge bg-warning">Moderação</span>';

                    const statusBadge = solicitacao.status === 'Aprovada'
                        ? '<span class="badge bg-success">Aprovada</span>'
                        : '<span class="badge bg-secondary">' + (solicitacao.status || 'N/A') + '</span>';

                    // Resumo executivo: motivo + síntese de 1 frase do que o cliente quer (gerada por IA
                    // no momento em que a resposta foi salva) + o que foi resolvido. Registros antigos,
                    // salvos antes desse recurso existir, caem no fallback de trecho truncado entre aspas.
                    const resumoTexto = solicitacao.resumoExecutivo
                        ? solicitacao.resumoExecutivo
                        : (solicitacao.textoCliente ? `"${truncar(solicitacao.textoCliente, 110)}"` : 'N/A');
                    const detalhesResumo = `
                        <strong>${solicitacao.tipoSolicitacao || 'N/A'}</strong><br>
                        <span class="${solicitacao.resumoExecutivo ? 'text-dark' : 'text-muted'}">${resumoTexto}</span>
                        ${solicitacao.solucaoImplementada ? `<br><span class="text-success"><i class="fas fa-check-circle me-1"></i>${truncar(solicitacao.solucaoImplementada, 100)}</span>` : ''}
                    `;

                    const detalhesExpandidos = `
                        <div class="campo-detalhe">
                            <div class="campo-label">Tipo de Solicitação:</div>
                            <div class="campo-valor">${solicitacao.tipoSolicitacao || 'N/A'}</div>
                        </div>
                        <div class="campo-detalhe">
                            <div class="campo-label">ID da Reclamação:</div>
                            <div class="campo-valor">${solicitacao.idReclamacao || solicitacao.id_reclamacao || 'N/A'}</div>
                        </div>
                        <div class="campo-detalhe">
                            <div class="campo-label">Texto do Cliente:</div>
                            <div class="campo-valor">${solicitacao.textoCliente || 'N/A'}</div>
                        </div>
                        <div class="campo-detalhe">
                            <div class="campo-label">Resposta Aprovada:</div>
                            <div class="campo-valor">${solicitacao.resposta || 'N/A'}</div>
                        </div>
                        ${solicitacao.solucaoImplementada ? `
                        <div class="campo-detalhe">
                            <div class="campo-label">Solução Implementada:</div>
                            <div class="campo-valor">${solicitacao.solucaoImplementada}</div>
                        </div>
                        ` : ''}
                        ${solicitacao.historicoAtendimento ? `
                        <div class="campo-detalhe">
                            <div class="campo-label">Histórico de Atendimento:</div>
                            <div class="campo-valor">${solicitacao.historicoAtendimento}</div>
                        </div>
                        ` : ''}
                        ${(solicitacao.nomeSolicitante || solicitacao.observacoesInternas) ? `
                        <div class="campo-detalhe">
                            <div class="campo-label">Nome do solicitante:</div>
                            <div class="campo-valor">${solicitacao.nomeSolicitante || solicitacao.observacoesInternas}</div>
                        </div>
                        ` : ''}
                    `;

                    return `
                        <tr>
                            <td>
                                <button class="btn-expandir" onclick="toggleDetalhesSolicitacao('${solicitacaoId}')" title="Expandir/Colapsar detalhes">
                                    <i class="fas fa-chevron-down" id="icon-${solicitacaoId}"></i>
                                </button>
                            </td>
                            <td>${solicitacao.data || 'N/A'}</td>
                            <td>${tipoBadge}</td>
                            <td><small>${solicitacao.idReclamacao || solicitacao.id_reclamacao || 'N/A'}</small></td>
                            <td><small>${detalhesResumo}</small></td>
                            <td>${statusBadge}</td>
                        </tr>
                        <tr id="${solicitacaoId}" class="detalhes-expandidos">
                            <td colspan="6">
                                <div class="detalhes-content">
                                    ${detalhesExpandidos}
                                </div>
                            </td>
                        </tr>
                    `;
                });

                // Um card por ID da Reclamação — dentro dele, um bloco por tentativa (1ª negada,
                // 2ª+ reformulação), cada um com seu próprio acordeão e botões de ação.
                const linhasModeracao = gruposModeracao.map((grupo, grupoIndex) => {
                    const grupoId = `grupo-moderacao-${grupo.idReclamacao || grupoIndex}`;
                    const ultimaTentativa = grupo.itens[grupo.itens.length - 1];
                    const temMultiplasTentativas = grupo.itens.length > 1;

                    // Se QUALQUER tentativa do grupo foi aceita, o card resumido mostra "Aceita" —
                    // mesmo que não seja a mais recente. Isso é seguro porque uma reformulação de
                    // verdade nunca parte de uma tentativa já aceita (o botão "Carregar pra
                    // Reformular" só aparece quando resultadoModeracao !== 'Aceita'); "Aceita seguida
                    // de Negada" só acontece em pares antigos sem vínculo (idModeracaoAnterior vazio —
                    // duas submissões independentes pra mesma reclamação, de antes desse recurso
                    // existir), onde a mais recente NÃO é uma correção da anterior e não deveria
                    // esconder que o caso já foi resolvido a favor.
                    const tentativaAceita = grupo.itens.find(item => item.resultadoModeracao === 'Aceita');
                    const tentativaParaStatus = tentativaAceita || ultimaTentativa;

                    const statusBadge = tentativaParaStatus.resultadoModeracao === 'Aceita'
                        ? '<span class="badge bg-success">Aceita</span>'
                        : tentativaParaStatus.resultadoModeracao === 'Negada'
                            ? '<span class="badge bg-danger">Negada</span>'
                            : '<span class="badge bg-secondary">Aguardando resultado</span>';

                    const tipoBadge = temMultiplasTentativas
                        ? `<span class="badge bg-warning">Moderação</span> <span class="badge bg-info text-dark">${grupo.itens.length} tentativas</span>`
                        : '<span class="badge bg-warning">Moderação</span>';

                    // Resumo executivo: motivo + síntese de 1 frase do que o cliente reclamou (gerada por
                    // IA ao marcar a moderação como coerente) + o que foi pedido à RA. Usa a mesma
                    // tentativa do status acima (a aceita, se houver) — pra não mostrar um resumo de uma
                    // tentativa diferente da que o badge de status está descrevendo. Registros antigos,
                    // salvos antes desse recurso existir, caem no fallback de trecho truncado entre aspas.
                    const resumoTexto = tentativaParaStatus.resumoExecutivo
                        ? tentativaParaStatus.resumoExecutivo
                        : (tentativaParaStatus.solicitacaoCliente ? `"${truncar(tentativaParaStatus.solicitacaoCliente, 110)}"` : 'N/A');
                    const detalhesResumo = `
                        <strong>${tentativaParaStatus.motivoModeracao || 'N/A'}</strong><br>
                        <span class="${tentativaParaStatus.resumoExecutivo ? 'text-dark' : 'text-muted'}">${resumoTexto}</span>
                        ${tentativaParaStatus.textoModeracao && tentativaParaStatus.textoModeracao !== 'N/A' ? `<br><span class="text-primary"><i class="fas fa-gavel me-1"></i>Pedido: ${truncar(tentativaParaStatus.textoModeracao, 90)}</span>` : ''}
                    `;

                    const blocosTentativas = grupo.itens.map((solicitacao, i) => {
                        const solicitacaoId = `solicitacao-moderacao-${solicitacao.id || `${grupoIndex}-${i}`}`;
                        // _grupoId aponta pra linha da tabela que precisa ser reaberta depois de
                        // registrar um resultado (a tentativa em si não é mais uma <tr> própria
                        // quando a reclamação tem múltiplas tentativas — ver toggleDetalhesSolicitacao).
                        solicitacoesCache[solicitacaoId] = { ...solicitacao, _grupoId: grupoId };

                        // Usar a posição no grupo já ordenado (não o campo numeroTentativa cru): a API
                        // sempre devolve numeroTentativa >= 1 (nunca vazio), então reclamações com 2+
                        // tentativas de ANTES desse recurso existir (sem a coluna Q preenchida) cairiam
                        // todas em "1" e apareceriam como "1ª tentativa" duplicado. A ordenação por
                        // numeroTentativa (com empate resolvido por ordem cronológica, JS sort é estável)
                        // já deixa o array na ordem certa — a posição em si é o rótulo certo.
                        const numero = i + 1;
                        // "(Reformulação)" só quando existe de fato o vínculo com a tentativa anterior
                        // (idModeracaoAnterior preenchido) — pares antigos sem esse vínculo (2 submissões
                        // independentes que coincidem no ID da reclamação, de antes desse recurso existir)
                        // não foram reformulados de verdade, então rotular como tal seria enganoso.
                        const ordinalLabel = numero === 1
                            ? '1ª tentativa'
                            : (solicitacao.idModeracaoAnterior ? `${numero}ª tentativa (Reformulação)` : `${numero}ª tentativa`);
                        const tentativaStatusBadge = solicitacao.resultadoModeracao === 'Aceita'
                            ? '<span class="badge bg-success">✅ Aceita</span>'
                            : solicitacao.resultadoModeracao === 'Negada'
                                ? '<span class="badge bg-danger">❌ Negada</span>'
                                : '<span class="badge bg-secondary">⏳ Aguardando resultado</span>';

                        // Só a tentativa mais recente pode virar ponto de partida pra uma nova
                        // reformulação — evita reformular em cima de uma tentativa já superada.
                        const ehUltima = i === grupo.itens.length - 1;

                        return `
                            <div class="border rounded p-3 mb-3 ${temMultiplasTentativas ? 'bg-white' : ''}">
                                ${temMultiplasTentativas ? `
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <h6 class="mb-0"><i class="fas fa-arrow-right me-2 text-muted"></i>${ordinalLabel}</h6>
                                    ${tentativaStatusBadge}
                                </div>
                                ` : ''}
                                ${renderDetalhesModeracao(solicitacao, solicitacaoId, { permitirReformular: ehUltima })}
                            </div>
                        `;
                    }).join('');

                    return `
                        <tr>
                            <td>
                                <button class="btn-expandir" onclick="toggleDetalhesSolicitacao('${grupoId}')" title="Expandir/Colapsar detalhes">
                                    <i class="fas fa-chevron-down" id="icon-${grupoId}"></i>
                                </button>
                            </td>
                            <td>${ultimaTentativa.data || 'N/A'}</td>
                            <td>${tipoBadge}</td>
                            <td><small>ID Reclamação: ${grupo.idReclamacao || 'N/A'}</small></td>
                            <td><small>${detalhesResumo}</small></td>
                            <td>${statusBadge}</td>
                        </tr>
                        <tr id="${grupoId}" class="detalhes-expandidos">
                            <td colspan="6">
                                <div class="detalhes-content">
                                    ${blocosTentativas}
                                </div>
                            </td>
                        </tr>
                    `;
                });

                tabela.innerHTML = linhasResposta.join('') + linhasModeracao.join('');
            }
        } else {
            throw new Error(data.error || 'Erro ao buscar solicitações');
        }
    } catch (error) {
        console.error('Erro ao buscar solicitações:', error);
        tabela.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Erro ao buscar solicitações: ${error.message}
                </td>
            </tr>
        `;
        showErrorMessage('Erro ao buscar solicitações: ' + error.message);
    }
}

// Função para corrigir dados desalinhados na planilha Moderações
async function corrigirModeracoes() {
    if (!confirm('Deseja corrigir os dados desalinhados na planilha Moderações?\n\nIsso irá reorganizar todos os dados nas colunas corretas.')) {
        return;
    }

    const btn = event.target.closest('button');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Corrigindo...';

    try {
        const response = await fetch('/api/corrigir-moderacoes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            showSuccessMessage(`✅ Correção concluída! ${data.linhasCorrigidas} linhas corrigidas.${data.erros > 0 ? ` ${data.erros} erros encontrados.` : ''}`);
            
            // Recarregar as solicitações após correção
            setTimeout(() => {
                buscarSolicitacoes();
            }, 1000);
        } else {
            showErrorMessage(`Erro ao corrigir: ${data.error || data.message}`);
        }
    } catch (error) {
        console.error('Erro ao corrigir moderações:', error);
        showErrorMessage('Erro ao corrigir moderações: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Traz uma moderação já buscada no modal "Todas as Solicitações" de volta pro formulário
// principal, permitindo reformular um caso antigo (não só o gerado na sessão atual).
function carregarModeracaoParaReformular(solicitacaoId) {
    const solicitacao = solicitacoesCache[solicitacaoId];
    if (!solicitacao || solicitacao.tipo !== 'moderacao') {
        showErrorMessage('Não foi possível carregar essa moderação. Busque novamente e tente de novo.');
        return;
    }

    switchTool('moderacao');

    const campoIdReclamacao = document.getElementById('id-reclamacao-moderacao');
    if (campoIdReclamacao) campoIdReclamacao.value = solicitacao.idReclamacao || '';

    const campoSolicitacao = document.getElementById('solicitacao-cliente');
    if (campoSolicitacao) campoSolicitacao.value = solicitacao.solicitacaoCliente && solicitacao.solicitacaoCliente !== 'N/A' ? solicitacao.solicitacaoCliente : '';

    const campoResposta = document.getElementById('resposta-empresa');
    if (campoResposta) campoResposta.value = solicitacao.respostaEmpresa && solicitacao.respostaEmpresa !== 'N/A' ? solicitacao.respostaEmpresa : '';

    const campoMotivo = document.getElementById('motivo-moderacao');
    if (campoMotivo && solicitacao.motivoModeracao) campoMotivo.value = solicitacao.motivoModeracao;

    const campoConsideracao = document.getElementById('consideracao-final-moderacao');
    if (campoConsideracao) campoConsideracao.value = solicitacao.consideracaoFinal && solicitacao.consideracaoFinal !== 'N/A' ? solicitacao.consideracaoFinal : '';

    const elTexto = document.getElementById('texto-moderacao');
    if (elTexto) elTexto.innerHTML = solicitacao.textoModeracao && solicitacao.textoModeracao !== 'N/A' ? solicitacao.textoModeracao : '';

    const elLinhaRaciocinio = document.getElementById('linha-raciocinio');
    if (elLinhaRaciocinio) elLinhaRaciocinio.innerHTML = solicitacao.linhaRaciocinio || '';

    window._hipoteseUtilizadaAtual = solicitacao.hipoteseUtilizada || '';

    const elAuditoria = document.getElementById('auditoria-hipotese');
    if (elAuditoria) {
        elAuditoria.innerHTML = solicitacao.hipoteseUtilizada
            ? formatarAuditoriaHipotese(solicitacao.hipoteseUtilizada, false)
            : '<small class="text-muted"><i class="fas fa-info-circle me-1"></i>Hipótese original não registrada para esta moderação (recurso adicionado depois deste caso).</small>';
    }

    const resultadoDiv = document.getElementById('moderacao-resultado');
    if (resultadoDiv) resultadoDiv.style.display = 'block';

    // Se essa moderação já foi registrada como "Negada", o e-mail real do RA já foi colado
    // naquele momento (fluxo do botão "Negada") — reaproveita em vez de pedir de novo.
    window._textoNegativaRAAtual = solicitacao.textoNegativaRA || '';

    // Guarda o id desta tentativa pra, se o agente marcar "Solicitação Coerente" sobre o texto
    // reformulado, a nova linha entrar encadeada como 2ª+ tentativa da mesma reclamação (não solta).
    window._moderacaoIdAnterior = solicitacao.id || '';

    const modalEl = document.getElementById('modalSolicitacoes');
    const modalInstance = modalEl && bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) modalInstance.hide();

    showSuccessMessage(window._textoNegativaRAAtual
        ? 'Moderação carregada com a negativa já registrada. Clique em "Reformular após Negativa" para reformular direto.'
        : 'Moderação carregada. Use "Reformular após Negativa" para reformular com base no motivo real.');
}

// Função para registrar resultado da moderação
async function registrarResultadoModeracao(moderacaoId, resultado, solicitacaoId) {
    if (!moderacaoId) {
        showErrorMessage('ID da moderação não encontrado. Não é possível registrar o resultado.');
        return;
    }

    if (!resultado || (resultado !== 'Aceita' && resultado !== 'Negada')) {
        showErrorMessage('Resultado inválido. Selecione "Aceita" ou "Negada".');
        return;
    }

    const botaoOriginal = event.target;

    if (resultado === 'Aceita') {
        const confirmacao = confirm('Deseja registrar que esta moderação foi ACEITA no Reclame Aqui?');
        if (!confirmacao) return;
        await executarRegistroResultado(moderacaoId, resultado, solicitacaoId, null, botaoOriginal);
        return;
    }

    // Negada: exige colar o e-mail de negativa real do RA antes de prosseguir — o sistema não
    // adivinha mais o motivo.
    abrirModalNegativaReal(moderacaoId, solicitacaoId, botaoOriginal);
}

// Modal obrigatório para colar o e-mail de negativa real do RA antes de registrar "Negada".
function abrirModalNegativaReal(moderacaoId, solicitacaoId, botaoOriginal) {
    const modalAnterior = document.getElementById('negativaRealModal');
    if (modalAnterior) modalAnterior.remove();

    const modalHtml = `
        <div class="modal fade" id="negativaRealModal" tabindex="-1" aria-labelledby="negativaRealModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title" id="negativaRealModalLabel">
                            <i class="fas fa-exclamation-triangle me-2"></i>Registrar Negativa do Reclame Aqui
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <label for="texto-negativa-real" class="form-label">
                            Cole aqui o e-mail de negativa completo enviado pelo Reclame Aqui: <span class="text-danger">*</span>
                        </label>
                        <textarea class="form-control" id="texto-negativa-real" rows="8" placeholder="Cole o e-mail inteiro, incluindo o 'Motivo principal da negativa' e o código no final (ex: -CO06)..."></textarea>
                        <div id="negativa-preview" class="mt-2"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-danger" onclick="confirmarNegativaReal('${String(moderacaoId).replace(/'/g, "\\'")}', '${solicitacaoId}')">
                            <i class="fas fa-check me-1"></i>Confirmar Negativa
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    window._negativaRealBotaoOriginal = botaoOriginal;

    const campoTexto = document.getElementById('texto-negativa-real');
    campoTexto.addEventListener('input', function () {
        const preview = document.getElementById('negativa-preview');
        const matchCodigo = this.value.match(/-\s*(CO\d+)\s*$/i) || this.value.match(/[-–]\s*(CO\d+)\b/i);
        const matchMotivo = this.value.match(/Motivo principal da negativa:\s*([^\n\r]+)/i);
        if (matchCodigo || matchMotivo) {
            preview.innerHTML = `<small class="text-muted"><i class="fas fa-info-circle me-1"></i>Detectado: ${matchCodigo ? matchCodigo[1].toUpperCase() : '(código não encontrado)'}${matchMotivo ? ' — ' + matchMotivo[1].trim() : ''}</small>`;
        } else {
            preview.innerHTML = '';
        }
    });

    const modal = new bootstrap.Modal(document.getElementById('negativaRealModal'));
    modal.show();
}

async function confirmarNegativaReal(moderacaoId, solicitacaoId) {
    const textoNegativaRA = document.getElementById('texto-negativa-real').value.trim();
    if (!textoNegativaRA) {
        showErrorMessage('Cole o e-mail de negativa do RA antes de confirmar.');
        return;
    }

    const modalEl = document.getElementById('negativaRealModal');
    const modalInstance = modalEl && bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) modalInstance.hide();

    const botaoOriginal = window._negativaRealBotaoOriginal;
    await executarRegistroResultado(moderacaoId, 'Negada', solicitacaoId, textoNegativaRA, botaoOriginal);
}

// Chamada real de gravação, compartilhada entre Aceita (sem negativa) e Negada (com o e-mail real).
async function executarRegistroResultado(moderacaoId, resultado, solicitacaoId, textoNegativaRA, botaoOriginal) {
    const btnOriginalText = botaoOriginal ? botaoOriginal.innerHTML : '';
    if (botaoOriginal) {
        botaoOriginal.disabled = true;
        botaoOriginal.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Salvando...';
    }

    try {
        console.log('📤 Enviando requisição para registrar resultado:', { moderacaoId, resultado, temNegativaReal: !!textoNegativaRA });

        const corpo = { moderacaoId, resultado };
        if (textoNegativaRA) corpo.textoNegativaRA = textoNegativaRA;

        const response = await fetch('/api/registrar-resultado-moderacao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo)
        });

        const data = await response.json();
        console.log('📥 Resposta do servidor:', data);

        if (!data.success) {
            throw new Error(data.error || 'Erro ao registrar resultado da moderação');
        }

        // Recarregar as solicitações para atualizar o resultado
        await buscarSolicitacoes();

        // Atualizar estatísticas do dia (Mod. Aprovadas / Mod. Negadas) na planilha e no modal
        carregarEstatisticasGlobais();

        // Re-expandir a linha que foi atualizada (se a reclamação tem várias tentativas, é a linha
        // do grupo — a tentativa em si não é mais uma <tr> própria; ver _grupoId no cache).
        const idParaReabrir = (solicitacoesCache[solicitacaoId] && solicitacoesCache[solicitacaoId]._grupoId) || solicitacaoId;
        setTimeout(() => {
            const detalhesRow = document.getElementById(idParaReabrir);
            if (detalhesRow && !detalhesRow.classList.contains('show')) {
                toggleDetalhesSolicitacao(idParaReabrir);
            }
        }, 500);

        showSuccessMessage(`Resultado da moderação registrado com sucesso: ${resultado === 'Aceita' ? 'Moderação Aceita' : 'Moderação Negada'}`);

    } catch (error) {
        console.error('Erro ao registrar resultado da moderação:', error);
        showErrorMessage(error.message || 'Erro ao registrar resultado da moderação. Tente novamente.');
        if (botaoOriginal) {
            botaoOriginal.disabled = false;
            botaoOriginal.innerHTML = btnOriginalText;
        }
    }
}

// Função para ver análise completa de moderação negada (FASE 4)
async function verAnaliseCompletaNegada(moderacaoId) {
    console.log('🔍 verAnaliseCompletaNegada chamada com ID:', moderacaoId);
    
    if (!moderacaoId) {
        showErrorMessage('ID da moderação não encontrado.');
        return;
    }
    
    // Verificar se o modal existe
    const modalElement = document.getElementById('modalAnaliseNegada');
    if (!modalElement) {
        console.error('❌ Modal modalAnaliseNegada não encontrado!');
        showErrorMessage('Modal de análise não encontrado. Recarregue a página.');
        return;
    }
    
    // Abrir modal
    const modal = new bootstrap.Modal(modalElement);
    const modalBody = document.getElementById('modalAnaliseNegadaBody');
    
    if (!modalBody) {
        console.error('❌ Modal body não encontrado!');
        showErrorMessage('Erro ao abrir modal. Recarregue a página.');
        return;
    }
    
    // Mostrar loading
    modalBody.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-danger" role="status">
                <span class="visually-hidden">Carregando...</span>
            </div>
            <p class="mt-3">Carregando análise completa...</p>
        </div>
    `;
    
    modal.show();
    
    try {
        console.log('📊 Buscando análise completa da moderação:', moderacaoId);
        
        const url = `/api/moderacao/${encodeURIComponent(moderacaoId)}`;
        console.log('🔗 URL da requisição:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error('❌ Erro HTTP:', response.status, response.statusText);
            const errorText = await response.text();
            console.error('❌ Resposta do servidor:', errorText);
            throw new Error(`Erro ao buscar moderação: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('📥 Dados recebidos:', data);
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao carregar análise completa');
        }
        
        const mod = data.moderacao;
        const tipo = data.tipo;
        const aprendizado = data.aprendizadoAplicado;

        // Dados do caso original, pra "Salvar Reformulação como Coerente" poder montar o registro
        // da 2ª+ tentativa sem precisar que o agente volte pro formulário principal.
        window._analiseCompletaCasoAtual = {
            moderacaoIdAnterior: moderacaoId,
            idReclamacao: mod.idReclamacao || '',
            solicitacaoCliente: mod.solicitacaoCliente || '',
            respostaEmpresa: mod.respostaEmpresa || '',
            motivo: mod.motivo || mod.motivoUtilizado || '',
            consideracaoFinal: mod.consideracaoFinal || ''
        };

        // Cabeçalho mínimo (ID/reclamação/resultado/data) — os dados brutos do caso (texto
        // enviado, solicitação, resposta, consideração, linha de raciocínio antiga) não se
        // repetem mais aqui: a análise da IA abaixo já os referencia dentro do raciocínio dela.
        let html = `
            <div class="mb-3">
                <h5 class="${tipo === 'negada' ? 'text-danger' : 'text-success'} mb-2">
                    <i class="fas ${tipo === 'negada' ? 'fa-exclamation-triangle' : 'fa-check-circle'} me-2"></i>
                    Moderação ${tipo === 'negada' ? 'Negada' : 'Aceita'} — Análise Completa
                </h5>
                <div class="text-muted small">
                    ID Moderação: ${mod.idModeracao || 'N/A'} &middot;
                    ID Reclamação: ${mod.idReclamacao || 'N/A'} &middot;
                    Registrado em: ${mod.dataRegistro || 'N/A'}
                </div>
            </div>
        `;

        if (aprendizado) {
            html += `
                <div class="alert alert-info py-2 mb-3">
                    <i class="fas fa-book me-2"></i>${aprendizado.mensagem || 'Esta moderação reforçou um modelo positivo existente.'}
                    ${aprendizado.pesoModelo ? ` (peso do modelo: ${aprendizado.pesoModelo.toFixed(2)})` : ''}
                </div>
            `;
        }

        if (tipo === 'negada' && mod.textoCompletoNegativa) {
            // Área onde a análise completa com IA carrega automaticamente (sem precisar de botão).
            html += `<div id="analise-completa-ia-corpo"></div>`;
        } else if (tipo === 'negada') {
            // Registro antigo (pré-captura do e-mail real da negativa): sem dado suficiente pra
            // rodar a auditoria com IA. Mostra o que existia da análise antiga, se houver.
            html += `
                <div class="alert alert-secondary">
                    <i class="fas fa-info-circle me-2"></i>Esta negativa foi registrada antes da captura do e-mail real do RA — não há dado suficiente para rodar a análise completa com IA.
                </div>
            `;
            if (mod.motivoNegativa || mod.ondeErrou || mod.comoCorrigir) {
                html += `
                    <div class="card mb-3">
                        <div class="card-header bg-light"><h6 class="mb-0">Análise registrada na época</h6></div>
                        <div class="card-body">
                            <p><strong>Motivo da negativa:</strong> ${mod.motivoNegativa || 'N/A'}</p>
                            <p><strong>Onde a solicitação errou:</strong> ${mod.ondeErrou || 'N/A'}</p>
                            <p class="mb-0"><strong>Como corrigir:</strong> ${mod.comoCorrigir || 'N/A'}</p>
                        </div>
                    </div>
                `;
            }
        }

        modalBody.innerHTML = html;

        // Roda a análise completa com IA automaticamente (sem exigir clique em botão) quando há
        // e-mail real da negativa. Feita depois de setar innerHTML pra #analise-completa-ia-corpo já existir.
        if (tipo === 'negada' && mod.textoCompletoNegativa) {
            gerarAnaliseCompletaIA(moderacaoId);
        }

    } catch (error) {
        console.error('❌ Erro ao carregar análise completa:', error);
        modalBody.innerHTML = `
            <div class="alert alert-danger">
                <h6><i class="fas fa-exclamation-triangle me-2"></i>Erro ao carregar análise</h6>
                <p>${error.message || 'Erro ao carregar a análise completa da moderação negada.'}</p>
            </div>
        `;
    }
}

// Roda a auditoria completa (IA) sobre uma moderação já negada, reaproveitando o e-mail real da
// negativa e a hipótese original já salvos — não pede pra colar nada de novo. Chamada
// automaticamente ao abrir o modal "Ver análise completa" (sem precisar de botão).
async function gerarAnaliseCompletaIA(moderacaoId) {
    const corpo = document.getElementById('analise-completa-ia-corpo');
    if (!corpo) return;

    corpo.innerHTML = `
        <div class="text-center py-3">
            <div class="spinner-border text-primary" role="status"><span class="visually-hidden">Carregando...</span></div>
            <p class="mt-2 mb-0 text-muted">Rodando auditoria completa (isso consulta os manuais e pode levar alguns segundos)...</p>
        </div>
    `;

    try {
        const response = await fetch(`/api/moderacao/${encodeURIComponent(moderacaoId)}/analise-completa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Erro ao gerar análise completa.');
        }

        let html = '';
        if (data.avisoNaoReenviar) {
            html += `<div class="alert alert-danger border-start border-danger border-4 mb-3">
                <h6 class="alert-heading"><i class="fas fa-ban me-2"></i>Não recomendamos reenviar este caso</h6>
                <p class="mb-0">A auditoria classificou a força da nova tentativa como <strong>🔴 Fraca</strong>${data.forcaJustificativa ? `: ${data.forcaJustificativa}` : '.'} A sugestão abaixo é só pra consulta.</p>
            </div>`;
        } else if (data.confiancaBaixa) {
            html += '<div class="alert alert-warning border-start border-warning border-4 mb-3"><strong><i class="fas fa-exclamation-triangle me-2"></i>Confiança baixa</strong> na nova tese — revise com atenção antes de usar.</div>';
        }
        html += formatarAuditoriaHipotese(data.auditoriaHipotese, data.confiancaBaixa);
        html += formatarLinhaRaciocinioServidor(data.linhaRaciocinio);
        html += '<hr>';
        html += '<h6 class="text-muted mb-2"><i class="fas fa-lightbulb me-2"></i>Sugestão de novo pedido (revise antes de usar em "Reformular após Negativa"):</h6>';
        html += formatarTextoModeracao(data.textoModeracaoSugerido);

        // Guarda os dados brutos da reformulação (strings, não o HTML formatado acima) pra
        // "Salvar Reformulação como Coerente" registrar exatamente o que a IA gerou.
        window._analiseCompletaReformulacao = {
            moderacaoIdAnterior: moderacaoId,
            textoModeracao: data.textoModeracaoSugerido || '',
            linhaRaciocinio: data.linhaRaciocinio || '',
            auditoriaHipotese: data.auditoriaHipotese || ''
        };

        if (!data.avisoNaoReenviar && data.textoModeracaoSugerido) {
            html += `
                <div class="mt-3 pt-3 border-top">
                    <button id="btn-salvar-reformulacao-coerente" class="btn btn-success" onclick="salvarReformulacaoComoCoerente('${String(moderacaoId).replace(/'/g, "\\'")}')">
                        <i class="fas fa-check-circle me-2"></i>Salvar Reformulação como Coerente
                    </button>
                    <div class="form-text">Registra este texto como a próxima tentativa dessa reclamação (encadeada à negativa acima). Depois, marque Aceita/Negada em "Todas as Solicitações" quando o RA responder.</div>
                </div>
            `;
        }

        corpo.innerHTML = html;
    } catch (error) {
        console.error('Erro ao gerar análise completa:', error);
        corpo.innerHTML = `<div class="alert alert-danger mb-0"><i class="fas fa-exclamation-triangle me-2"></i>${error.message || 'Erro ao gerar análise completa.'}</div>`;
    }
}

// Salva o texto reformulado (gerado em "Ver Análise Completa") como coerente, encadeando-o como
// a tentativa seguinte da mesma reclamação — sem exigir que o agente copie tudo de volta pro
// formulário principal via "Carregar pra Reformular".
async function salvarReformulacaoComoCoerente(moderacaoIdAnterior) {
    const caso = window._analiseCompletaCasoAtual;
    const reformulacao = window._analiseCompletaReformulacao;

    if (!caso || caso.moderacaoIdAnterior !== moderacaoIdAnterior || !reformulacao || reformulacao.moderacaoIdAnterior !== moderacaoIdAnterior) {
        showErrorMessage('Não foi possível identificar os dados dessa reformulação. Feche e reabra a análise completa.');
        return;
    }
    if (!reformulacao.textoModeracao || !reformulacao.linhaRaciocinio) {
        showErrorMessage('A reformulação ainda não terminou de carregar.');
        return;
    }

    const btn = document.getElementById('btn-salvar-reformulacao-coerente');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Salvando...';
    }

    try {
        const response = await fetch('/api/save-modelo-moderacao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                idReclamacao: caso.idReclamacao,
                dadosModeracao: {
                    solicitacaoCliente: caso.solicitacaoCliente,
                    respostaEmpresa: caso.respostaEmpresa,
                    motivoModeracao: caso.motivo,
                    consideracaoFinal: caso.consideracaoFinal
                },
                linhaRaciocinio: reformulacao.linhaRaciocinio,
                auditoriaHipotese: reformulacao.auditoriaHipotese,
                textoModeracao: reformulacao.textoModeracao,
                idModeracaoAnterior: moderacaoIdAnterior
            })
        });
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Erro ao salvar a reformulação como coerente.');
        }

        if (btn) {
            btn.innerHTML = `<i class="fas fa-check-circle me-2"></i>Salva como ${data.numeroTentativa}ª tentativa`;
        }
        showSuccessMessage(`✅ Reformulação salva como coerente (${data.numeroTentativa}ª tentativa)! Abra "Todas as Solicitações" pra registrar Aceita/Negada quando o RA responder.`);
        carregarEstatisticasGlobais();
    } catch (error) {
        console.error('Erro ao salvar reformulação como coerente:', error);
        showErrorMessage(error.message || 'Erro ao salvar a reformulação como coerente.');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

// Função para limpar resultado da moderação (para testes)
async function limparResultadoModeracao(moderacaoId, solicitacaoId) {
    if (!moderacaoId) {
        showErrorMessage('ID da moderação não encontrado.');
        return;
    }
    
    // Confirmar ação
    const confirmacao = confirm('Deseja limpar o resultado desta moderação? Isso permitirá testar novamente.');
    if (!confirmacao) {
        return;
    }
    
    // Mostrar loading
    const btnLimpar = event.target;
    const btnOriginalText = btnLimpar.innerHTML;
    btnLimpar.disabled = true;
    btnLimpar.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Limpando...';
    
    try {
        console.log('🧹 Limpando resultado da moderação:', moderacaoId);
        
        const response = await fetch('/api/limpar-resultado-moderacao', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                moderacaoId: moderacaoId
            })
        });
        
        const data = await response.json();
        console.log('📥 Resposta do servidor:', data);
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao limpar resultado da moderação');
        }
        
        // Recarregar as solicitações
        await buscarSolicitacoes();

        // Re-expandir a linha (linha do grupo, se a reclamação tem várias tentativas — ver _grupoId)
        const idParaReabrir = (solicitacoesCache[solicitacaoId] && solicitacoesCache[solicitacaoId]._grupoId) || solicitacaoId;
        setTimeout(() => {
            const detalhesRow = document.getElementById(idParaReabrir);
            if (detalhesRow && !detalhesRow.classList.contains('show')) {
                toggleDetalhesSolicitacao(idParaReabrir);
            }
        }, 500);

        showSuccessMessage('Resultado da moderação limpo com sucesso! Agora você pode testar novamente.');
        
    } catch (error) {
        console.error('Erro ao limpar resultado da moderação:', error);
        showErrorMessage(error.message || 'Erro ao limpar resultado da moderação. Tente novamente.');
        btnLimpar.disabled = false;
        btnLimpar.innerHTML = btnOriginalText;
    }
}

// Função para expandir/colapsar detalhes da solicitação
function toggleDetalhesSolicitacao(solicitacaoId) {
    const detalhesRow = document.getElementById(solicitacaoId);
    const icon = document.getElementById(`icon-${solicitacaoId}`);
    
    if (!detalhesRow || !icon) {
        console.error('Elemento não encontrado:', solicitacaoId);
        return;
    }
    
    // Alternar classe show para mostrar/ocultar
    if (detalhesRow.classList.contains('show')) {
        detalhesRow.classList.remove('show');
        icon.classList.remove('fa-chevron-up');
        icon.classList.add('fa-chevron-down');
    } else {
        detalhesRow.classList.add('show');
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-up');
    }
}

// Exportar solicitações
function exportarSolicitacoes() {
    const tabela = document.getElementById('tabelaSolicitacoes');
    const linhas = tabela.querySelectorAll('tr');
    
    if (linhas.length === 0 || linhas[0].querySelector('td[colspan]')) {
        showErrorMessage('Não há dados para exportar');
        return;
    }
    
    let csv = 'Data/Hora,Tipo,ID,Detalhes,Status\n';
    
    linhas.forEach(linha => {
        // Ignorar linhas de detalhes expandidos
        if (linha.classList.contains('detalhes-expandidos')) {
            return;
        }
        
        const celulas = linha.querySelectorAll('td');
        // Agora são 6 colunas (incluindo a coluna de ação)
        if (celulas.length >= 5) {
            // Pular a primeira coluna (botão expandir) e pegar as outras
            const valores = Array.from(celulas).slice(1).map(celula => {
                // Remover HTML e pegar apenas texto
                const texto = celula.textContent.trim().replace(/\n/g, ' ').replace(/,/g, ';');
                return `"${texto}"`;
            });
            csv += valores.join(',') + '\n';
        }
    });
    
    // Criar blob e download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `solicitacoes_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showSuccessMessage('Solicitações exportadas com sucesso!');
}

function showSuccessMessage(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    
    // Tentar diferentes seletores para encontrar o container
    const container = document.querySelector('.container') || 
                     document.querySelector('.container-fluid') || 
                     document.body;
    
    container.appendChild(successDiv);
    
    setTimeout(() => {
        if (successDiv.parentNode) {
        successDiv.remove();
        }
    }, 5000);
}

function showErrorMessage(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${message}`;
    
    // Tentar diferentes seletores para encontrar o container
    const container = document.querySelector('.container') || 
                     document.querySelector('.container-fluid') || 
                     document.body;
    
    container.appendChild(errorDiv);
    
    setTimeout(() => {
        if (errorDiv.parentNode) {
        errorDiv.remove();
        }
    }, 5000);
}

// ================== EXPORTAÇÕES PARA USO GLOBAL ==================
// Exportar funções principais
window.velotaxBot = {
    gerarRespostaOpenAI,
    gerarModeracao,
    gerarExplicacao,
    analisarChanceModeracao,
    gerarEmail,
    gerarRelatorioReclamacoes,
    aplicarCorrecoesRelatorioReclamacoes,
    copiarRelatorioReclamacoes,
    salvarRascunho,
    carregarRascunho,
    copiarResposta,
    verHistorico,
    fecharHistorico,
    testarFuncao,
    avaliarResposta,
    avaliarModeracao,
    copiarRespostaOpenAI,
    limparRespostaOpenAI,
    copiarModeracao,
    cancelarReformulacao,
    gerarFeedbackModeracao
};

// Exportar configurações para uso global
window.velotaxConfig = {
    DOMINIO_CORPORATIVO,
    NOME_EMPRESA,
    SITE_EMPRESA
};

// Função para reformular moderação após negativa
function reformularAposNegativa() {
    console.log('🔄 Iniciando reformulação após negativa...');

    // Verificar se há texto de moderação gerado
    const textoModeracao = document.getElementById('texto-moderacao');
    if (!textoModeracao || !textoModeracao.innerText.trim()) {
        showErrorMessage('Nenhuma solicitação de moderação foi gerada ainda. Gere uma solicitação primeiro.');
        return;
    }

    // Essa moderação já foi marcada "Negada" com o e-mail real colado naquele momento —
    // reaproveita em vez de pedir de novo (o dado já foi capturado uma vez).
    if (window._textoNegativaRAAtual) {
        processarReformulacaoAposNegativa(window._textoNegativaRAAtual);
        return;
    }

    // Mostrar modal exigindo o e-mail real de negativa do RA — o sistema não adivinha mais o motivo.
    const modalHtml = `
        <div class="modal fade" id="negativaModal" tabindex="-1" aria-labelledby="negativaModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="negativaModalLabel">
                            <i class="fas fa-exclamation-triangle me-2"></i>
                            Reformular após Negativa do RA
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="texto-negativa-reformular" class="form-label">
                                <strong>Cole aqui o e-mail de negativa completo enviado pelo Reclame Aqui:</strong> <span class="text-danger">*</span>
                            </label>
                            <textarea
                                class="form-control"
                                id="texto-negativa-reformular"
                                rows="8"
                                placeholder="Cole o e-mail inteiro, incluindo o 'Motivo principal da negativa' e o código no final (ex: -CO06)..."
                                required
                            ></textarea>
                            <div id="negativa-reformular-preview" class="mt-2"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-danger" onclick="processarReformulacaoAposNegativa()">
                            <i class="fas fa-redo me-1"></i>
                            Reformular Solicitação
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remover modal anterior se existir
    const modalAnterior = document.getElementById('negativaModal');
    if (modalAnterior) {
        modalAnterior.remove();
    }

    // Adicionar modal ao DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const campoTexto = document.getElementById('texto-negativa-reformular');
    campoTexto.addEventListener('input', function () {
        const preview = document.getElementById('negativa-reformular-preview');
        const matchCodigo = this.value.match(/-\s*(CO\d+)\s*$/i) || this.value.match(/[-–]\s*(CO\d+)\b/i);
        const matchMotivo = this.value.match(/Motivo principal da negativa:\s*([^\n\r]+)/i);
        if (matchCodigo || matchMotivo) {
            preview.innerHTML = `<small class="text-muted"><i class="fas fa-info-circle me-1"></i>Detectado: ${matchCodigo ? matchCodigo[1].toUpperCase() : '(código não encontrado)'}${matchMotivo ? ' — ' + matchMotivo[1].trim() : ''}</small>`;
        } else {
            preview.innerHTML = '';
        }
    });

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('negativaModal'));
    modal.show();
}

// Função para processar reformulação após negativa. Se textoNegativaRAParam vier preenchido
// (negativa já registrada anteriormente para essa moderação), pula o modal e reaproveita direto.
async function processarReformulacaoAposNegativa(textoNegativaRAParam) {
    const reaproveitando = !!textoNegativaRAParam;
    const textoNegativaRA = reaproveitando
        ? textoNegativaRAParam
        : document.getElementById('texto-negativa-reformular').value.trim();

    if (!textoNegativaRA) {
        showErrorMessage('Cole o e-mail de negativa do RA antes de reformular.');
        return;
    }

    // Fechar modal, se houver um aberto (não existe quando a negativa já foi reaproveitada)
    const modalEl = document.getElementById('negativaModal');
    if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }

    // Mostrar loading
    showLoadingMessage('Reformulando solicitação de moderação com base na negativa real do RA...');

    try {
        // Obter dados da moderação atual
        const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
        const respostaEmpresa = document.getElementById('resposta-empresa').value;
        const motivoModeracao = document.getElementById('motivo-moderacao').value;
        const consideracaoFinal = (document.getElementById('consideracao-final-moderacao') || {}).value || '';
        const textoNegado = document.getElementById('texto-moderacao').innerText;
        const hipoteseUtilizada = window._hipoteseUtilizadaAtual || '';

        // Chamar o endpoint do servidor para reformulação
        const response = await fetch('/api/reformulate-moderation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                textoNegado: textoNegado,
                textoNegativaRA: textoNegativaRA,
                dadosModeracao: {
                    solicitacaoCliente: solicitacaoCliente,
                    respostaEmpresa: respostaEmpresa,
                    motivoModeracao: motivoModeracao,
                    consideracaoFinal: consideracaoFinal,
                    hipoteseUtilizada: hipoteseUtilizada
                }
            })
        });

        const data = await response.json();

        if (data.success) {
            // Resposta rica do servidor (auditoria completa + linha de raciocínio + pedido novo),
            // no mesmo formato usado na geração inicial — mesma renderização, mesmas funções.
            const auditoria = data.auditoriaHipotese || '';
            const confiancaBaixa = !!data.confiancaBaixa;
            const linhaRaciocinioBruta = data.linhaRaciocinio || '';
            const textoFinalBruto = data.textoModeracao || data.result;

            const elAuditoria = document.getElementById('auditoria-hipotese');
            if (elAuditoria) elAuditoria.innerHTML = formatarAuditoriaHipotese(auditoria, confiancaBaixa);
            window._hipoteseUtilizadaAtual = auditoria || '';

            const linhaRaciocinio = document.getElementById('linha-raciocinio');
            linhaRaciocinio.innerHTML = formatarLinhaRaciocinioServidor(linhaRaciocinioBruta);

            // O PEDIDO REFORMULADO (o que de fato importa) é o texto abaixo — substitui o antigo.
            const textoModeracao = document.getElementById('texto-moderacao');
            textoModeracao.innerHTML = formatarTextoModeracao(textoFinalBruto);

            // Quando a força da nova tentativa sai Fraca, o pedido ainda é gerado (pra não
            // esconder informação), mas com um aviso difícil de ignorar: reenviar um caso sem
            // sustentação real só gasta cota diária e reforça negativas.
            const avisoExistente = document.getElementById('aviso-nao-reenviar');
            if (avisoExistente) avisoExistente.remove();
            if (data.avisoNaoReenviar) {
                const aviso = document.createElement('div');
                aviso.id = 'aviso-nao-reenviar';
                aviso.className = 'alert alert-danger border-start border-danger border-4 mt-3 mb-0';
                aviso.innerHTML = `
                    <h6 class="alert-heading"><i class="fas fa-ban me-2"></i>Não recomendamos reenviar este caso</h6>
                    <p class="mb-0">A auditoria classificou a força da nova tentativa como <strong>🔴 Fraca</strong>${data.forcaJustificativa ? `: ${data.forcaJustificativa}` : '.'} O texto abaixo foi gerado mesmo assim para consulta, mas reenviar um caso sem sustentação real tende a gastar cota diária de moderação sem mudar o resultado.</p>
                `;
                textoModeracao.insertAdjacentElement('afterend', aviso);
            }

            // Esconde uma caixa de "Análise de Feedback" de uma ação anterior (Dar Feedback), se
            // estiver visível — não é dessa ação e só teria confundido com conteúdo desatualizado.
            const feedbackSectionAntiga = document.getElementById('feedback-moderacao');
            if (feedbackSectionAntiga) feedbackSectionAntiga.style.display = 'none';

            if (data.avisoNaoReenviar) {
                showErrorMessage('Pedido reformulado, mas com força Fraca — não recomendamos reenviar. Veja o aviso abaixo do texto.');
            } else if (confiancaBaixa) {
                showSuccessMessage('Pedido reformulado. Atenção: a auditoria sinalizou confiança baixa na nova tese, revise antes de enviar.');
            } else {
                showSuccessMessage('Pedido de moderação reformulado — confira a auditoria e o novo texto logo abaixo.');
            }

            // Garante que o pedido novo fique visível na tela, não só o topo do formulário.
            const resultadoDiv = document.getElementById('moderacao-resultado');
            if (resultadoDiv) resultadoDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Limpar modal
            setTimeout(() => {
                const modal = document.getElementById('negativaModal');
                if (modal) {
                    modal.remove();
                }
            }, 500);

        } else {
            showErrorMessage(data.error || 'Erro ao reformular solicitação de moderação.');
        }

    } catch (error) {
        console.error('Erro ao reformular moderação:', error);
        showErrorMessage('Erro ao conectar com o servidor. Verifique sua conexão.');
    }
}

// ===== AUDITORIA EXECUTIVA =====
const AUDITORIA_CFG_PADRAO = {
    fatorResp: 0.25, respMin: 3, respMax: 12,
    fatorAceitas: 0.15, aceitasMin: 5, aceitasMax: 40,
    fatorNegadas: 0.08, negadasMin: 3, negadasMax: 20,
    pesoResp: 0.5, pesoAceitas: 0.3, pesoNegadas: 0.2
};

function getConfigAuditoria() {
    try {
        const salvo = JSON.parse(localStorage.getItem('auditoriaConfig') || '{}');
        return { ...AUDITORIA_CFG_PADRAO, ...salvo };
    } catch (e) {
        return { ...AUDITORIA_CFG_PADRAO };
    }
}

async function carregarAuditoria(force = false) {
    const janelaSel = document.getElementById('auditoria-janela');
    const janela = janelaSel ? janelaSel.value : 90;
    const loading = document.getElementById('auditoria-loading');
    const erro = document.getElementById('auditoria-erro');
    const conteudo = document.getElementById('auditoria-conteudo');
    if (!conteudo) return;

    window._auditoriaCarregada = true;
    if (loading) loading.style.display = 'block';
    if (erro) erro.style.display = 'none';
    if (force) conteudo.innerHTML = '';

    try {
        const cfg = getConfigAuditoria();
        const params = new URLSearchParams({ janela: String(janela) });
        Object.keys(cfg).forEach(k => params.set(k, String(cfg[k])));
        if (force) params.set('_', String(Date.now()));
        const url = `/api/auditoria?${params.toString()}`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (!data.success || !data.relatorio) {
            throw new Error(data.error || 'Não foi possível gerar a auditoria.');
        }
        conteudo.innerHTML = renderAuditoria(data.relatorio, data.fromCache);
    } catch (e) {
        console.error('Erro ao carregar auditoria:', e);
        if (erro) {
            erro.style.display = 'block';
            erro.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i>${escAud(e.message || 'Erro ao carregar auditoria.')}`;
        }
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function escAud(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function preencherCamposConfigAuditoria() {
    const cfg = getConfigAuditoria();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('cfg-fatorResp', Math.round(cfg.fatorResp * 100));
    set('cfg-respMin', cfg.respMin);
    set('cfg-respMax', cfg.respMax);
    set('cfg-fatorAceitas', Math.round(cfg.fatorAceitas * 100));
    set('cfg-aceitasMin', cfg.aceitasMin);
    set('cfg-aceitasMax', cfg.aceitasMax);
    set('cfg-fatorNegadas', Math.round(cfg.fatorNegadas * 100));
    set('cfg-negadasMin', cfg.negadasMin);
    set('cfg-negadasMax', cfg.negadasMax);
    set('cfg-pesoResp', Math.round(cfg.pesoResp * 100));
    set('cfg-pesoAceitas', Math.round(cfg.pesoAceitas * 100));
    set('cfg-pesoNegadas', Math.round(cfg.pesoNegadas * 100));
}

function toggleConfigAuditoria() {
    const painel = document.getElementById('auditoria-config');
    if (!painel) return;
    const visivel = painel.style.display !== 'none';
    if (!visivel) preencherCamposConfigAuditoria();
    painel.style.display = visivel ? 'none' : 'block';
}

function aplicarConfigAuditoria() {
    const num = (id, def) => {
        const el = document.getElementById(id);
        const n = el ? parseFloat(el.value) : NaN;
        return Number.isFinite(n) ? n : def;
    };
    const cfg = {
        fatorResp: num('cfg-fatorResp', 25) / 100,
        respMin: Math.round(num('cfg-respMin', 3)),
        respMax: Math.round(num('cfg-respMax', 12)),
        fatorAceitas: num('cfg-fatorAceitas', 15) / 100,
        aceitasMin: Math.round(num('cfg-aceitasMin', 5)),
        aceitasMax: Math.round(num('cfg-aceitasMax', 40)),
        fatorNegadas: num('cfg-fatorNegadas', 8) / 100,
        negadasMin: Math.round(num('cfg-negadasMin', 3)),
        negadasMax: Math.round(num('cfg-negadasMax', 20)),
        pesoResp: num('cfg-pesoResp', 50) / 100,
        pesoAceitas: num('cfg-pesoAceitas', 30) / 100,
        pesoNegadas: num('cfg-pesoNegadas', 20) / 100
    };
    try { localStorage.setItem('auditoriaConfig', JSON.stringify(cfg)); } catch (e) {}
    carregarAuditoria(true);
}

function restaurarConfigAuditoria() {
    try { localStorage.removeItem('auditoriaConfig'); } catch (e) {}
    preencherCamposConfigAuditoria();
    carregarAuditoria(true);
}

function corPct(pct) {
    if (pct >= 60) return 'success';
    if (pct >= 35) return 'warning';
    return 'danger';
}

function kpiCard(valor, label, icon, cor) {
    return `
        <div class="col-6 col-md-3 mb-3">
            <div class="card h-100 border-0 shadow-sm">
                <div class="card-body text-center py-3">
                    <div class="text-${cor}" style="font-size:1.6rem;"><i class="fas ${icon}"></i></div>
                    <div class="fw-bold" style="font-size:1.8rem; line-height:1.1;">${valor}</div>
                    <div class="text-muted small">${label}</div>
                </div>
            </div>
        </div>`;
}

function tabelaDistribuicao(obj, titulo, max = 10) {
    const itens = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, max);
    if (itens.length === 0) return '';
    const total = Object.values(obj).reduce((a, b) => a + b, 0) || 1;
    const linhas = itens.map(([k, v]) => {
        const p = Math.round((v / total) * 100);
        return `
            <div class="mb-2">
                <div class="d-flex justify-content-between small">
                    <span class="text-truncate me-2" title="${escAud(k)}">${escAud(k)}</span>
                    <span class="text-muted">${v} (${p}%)</span>
                </div>
                <div class="progress" style="height:6px;">
                    <div class="progress-bar bg-info" style="width:${p}%"></div>
                </div>
            </div>`;
    }).join('');
    return `<div class="mb-3"><h6 class="text-muted text-uppercase small fw-bold mb-2">${escAud(titulo)}</h6>${linhas}</div>`;
}

function renderAuditoria(r, fromCache) {
    const res = r.resumo || {};
    const apr = r.aprendizado || {};
    const mod = r.moderacoes || {};

    // KPIs principais
    let html = `
        <div class="d-flex justify-content-between align-items-center flex-wrap mb-3">
            <div class="text-muted small">
                <i class="fas fa-calendar-alt me-1"></i> Período: <strong>${escAud(r.periodo?.de)}</strong> a <strong>${escAud(r.periodo?.ate)}</strong>
                &nbsp;·&nbsp; Gerado em ${escAud(r.geradoEm)} ${fromCache ? '<span class="badge bg-secondary">cache</span>' : ''}
            </div>
        </div>
        <div class="row">
            ${kpiCard(res.coerentesPeriodo ?? 0, 'Respostas coerentes', 'fa-check-circle', 'success')}
            ${kpiCard(res.feedbacksPeriodo ?? 0, 'Feedbacks (correções)', 'fa-comment-dots', 'warning')}
            ${kpiCard(res.moderacoesPeriodo ?? 0, 'Moderações registradas', 'fa-shield-alt', 'primary')}
            ${kpiCard(res.moderacoesAprovadas ?? 0, 'Moderações aprovadas', 'fa-thumbs-up', 'info')}
        </div>
        <div class="row">
            ${kpiCard((res.pctBons ?? 0) + '%', 'Coerentes no padrão atual', 'fa-star', corPct(res.pctBons ?? 0))}
            ${kpiCard(res.coerentesBons ?? 0, 'Coerentes de qualidade', 'fa-award', 'success')}
            ${kpiCard(res.moderacoesAceitas ?? 0, 'Moderações aceitas (RA)', 'fa-check-double', 'success')}
            ${kpiCard(res.moderacoesNegadas ?? 0, 'Moderações negadas (RA)', 'fa-times-circle', 'danger')}
        </div>`;

    // Índice de maturidade do aprendizado
    const mat = r.maturidade;
    if (mat) {
        const cor = corPct(mat.indice);
        const comps = (mat.componentes || []).map(c => `
            <div class="mb-2">
                <div class="d-flex justify-content-between small">
                    <span>${escAud(c.nome)} <span class="text-muted">(peso ${c.peso}%${c.detalhe ? ' · ' + escAud(c.detalhe) : ''})</span></span>
                    <span class="fw-bold">${c.valor}%</span>
                </div>
                <div class="progress" style="height:6px;">
                    <div class="progress-bar bg-${corPct(c.valor)}" style="width:${c.valor}%"></div>
                </div>
            </div>`).join('');
        html += `
            <div class="card border-0 shadow-sm mb-3">
                <div class="card-body">
                    <div class="row align-items-center">
                        <div class="col-md-4 text-center border-end">
                            <h6 class="text-muted text-uppercase small fw-bold mb-2"><i class="fas fa-gauge-high me-1"></i> Maturidade do aprendizado</h6>
                            <div class="text-${cor}" style="font-size:3rem; font-weight:700; line-height:1;">${mat.indice}%</div>
                            <div class="progress mt-2" style="height:10px;">
                                <div class="progress-bar bg-${cor}" style="width:${mat.indice}%"></div>
                            </div>
                            <div class="small text-muted mt-1">0% = base vazia · 100% = base ideal</div>
                        </div>
                        <div class="col-md-8 mt-3 mt-md-0">
                            <h6 class="text-muted text-uppercase small fw-bold mb-2">Composição do índice</h6>
                            ${comps}
                        </div>
                    </div>
                </div>
            </div>`;
    }

    // Vigilância de marcações (aprendizado de moderação)
    const vig = r.vigilanciaMarcacoes;
    if (vig) {
        const lim = vig.limiteDiasAlerta ?? 7;
        const diasRA = vig.diasSemResultadoRA ?? vig.diasDesdeUltimaMarcacao;
        const fmtV = (n) => (n === null || n === undefined ? 'nunca' : (n === 0 ? 'hoje' : `há ${n}d`));
        const nivel = vig.nivelAlerta ?? 0;
        const nivelBadge = nivel >= 3 ? ['danger', 'Alerta (21+ dias)']
            : nivel >= 2 ? ['warning', 'Atenção (14+ dias)']
            : nivel >= 1 ? ['info', 'Informativo (7+ dias)']
            : ['success', 'Normal'];
        const corVig = nivelBadge[0];
        const emailOk = vig.email?.configurado;
        const niveis = (vig.niveisLembrete || [7, 14, 21]).join(' / ');
        html += `
            <div class="card border-0 shadow-sm mb-3 border-start border-4 border-${corVig}">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
                        <h6 class="text-muted text-uppercase small fw-bold mb-0">
                            <i class="fas fa-bell me-1"></i> Vigilância de marcações (aprendizado)
                        </h6>
                        <div class="d-flex flex-wrap gap-1">
                            <span class="badge bg-${corVig}">${nivelBadge[1]}</span>
                            <span class="badge bg-${emailOk ? 'success' : 'secondary'}">${emailOk ? 'E-mail configurado' : 'E-mail pendente na Vercel'}</span>
                        </div>
                    </div>
                    ${vig.semMarcacaoRegistrada
                        ? '<p class="small text-danger mb-2"><strong>Nenhuma marcação registrada</strong> na planilha (aprovada, aceita ou negada).</p>'
                        : `<p class="mb-2">Sem aceita/negada registrada: <strong class="text-${corVig}">${diasRA === 0 ? 'hoje' : (diasRA ?? '—') + ' dia(s)'}</strong>
                            ${vig.ultimoResultadoRAEm ? `— último resultado em ${escAud(vig.ultimoResultadoRAEm)} (${escAud(vig.ultimoResultadoRATipo || '')})` : ''}.</p>`}
                    <div class="row small mb-2">
                        <div class="col-md-4"><i class="fas fa-thumbs-up text-info me-1"></i> Aprovada (coerente): <strong>${fmtV(vig.diasDesdeUltimaAprovada)}</strong></div>
                        <div class="col-md-4"><i class="fas fa-check-double text-success me-1"></i> Aceita RA: <strong>${fmtV(vig.diasDesdeUltimaAceita)}</strong></div>
                        <div class="col-md-4"><i class="fas fa-times-circle text-danger me-1"></i> Negada c/ análise: <strong>${fmtV(vig.diasDesdeUltimaNegada)}</strong></div>
                    </div>
                    <div class="small text-muted">
                        <span class="badge bg-warning text-dark me-1">${vig.moderacoesPendentes ?? 0} pendentes</span>
                        Lembretes escalonados em <strong>${niveis}</strong> dias sem aceita ou negada.
                        ${vig.emAlerta && emailOk ? '<span class="text-danger ms-1"><i class="fas fa-exclamation-triangle"></i> Nível ativo — e-mail enviado ao atingir cada marco (reenvio semanal no nível 21+).</span>' : ''}
                        ${vig.emAlerta && !emailOk ? '<span class="text-danger ms-1"><i class="fas fa-exclamation-triangle"></i> Em alerta — configure SMTP/Resend na Vercel para disparar lembretes.</span>' : ''}
                    </div>
                </div>
            </div>`;
    }

    // Onde focar: lacunas + projeção de ganho
    const op = r.oportunidades;
    if (op) {
        const proj = (op.projecoes || []).map(p => {
            const corG = p.ganhoPts > 0 ? 'success' : 'secondary';
            return `
                <div class="d-flex justify-content-between align-items-center border-bottom py-2">
                    <span class="small">${escAud(p.acao)}</span>
                    <span class="badge bg-${corG}">${p.ganhoPts > 0 ? '+' + p.ganhoPts + ' pts' : 'sem ganho'}</span>
                </div>`;
        }).join('');
        const lacunas = (op.tiposComLacuna || []).map(t => `
            <tr>
                <td class="text-truncate" style="max-width:160px;" title="${escAud(t.tipo)}">${escAud(t.tipo)}</td>
                <td class="text-center">${t.demanda ?? '-'}</td>
                <td class="text-center">${t.bons}/${t.meta}</td>
                <td class="text-center"><span class="badge bg-warning text-dark">faltam ${t.faltam}</span></td>
            </tr>`).join('');
        const janelaTxt = op.janelaDias ? `últimos ${op.janelaDias} dias` : 'período';
        html += `
            <div class="row">
                <div class="col-lg-6 mb-3">
                    <div class="card border-0 shadow-sm h-100">
                        <div class="card-body">
                            <h6 class="text-muted text-uppercase small fw-bold mb-2"><i class="fas fa-bullseye me-1"></i> Projeção de ganho (quanto a maturidade sobe)</h6>
                            <p class="small text-muted mb-2">Estimativa de quantos pontos o índice de maturidade ganharia ao registrar mais exemplos (na janela: ${janelaTxt}):</p>
                            ${proj || '<div class="text-muted small">Base já no nível ideal — sem ganhos relevantes a projetar.</div>'}
                        </div>
                    </div>
                </div>
                <div class="col-lg-6 mb-3">
                    <div class="card border-0 shadow-sm h-100">
                        <div class="card-body">
                            <h6 class="text-muted text-uppercase small fw-bold mb-2"><i class="fas fa-percent me-1"></i> Assertividade de moderação (${janelaTxt})</h6>
                            ${(() => {
                                const a = res.assertividadeModeracao;
                                const meta = res.assertividadeMeta ?? 85;
                                if (a === null || a === undefined) {
                                    return '<div class="text-muted small">Ainda não há moderações com resultado (aceita/negada) registrado nesta janela para calcular a assertividade.</div>';
                                }
                                const cor = a >= meta ? 'success' : (a >= meta - 15 ? 'warning' : 'danger');
                                const aceitas = res.moderacoesAceitas ?? 0;
                                const negadas = res.moderacoesNegadas ?? 0;
                                const base = res.assertividadeBase ?? (aceitas + negadas);
                                return `
                                    <p class="small text-muted mb-2">Percentual de moderações <strong>aceitas pelo RA</strong> entre as que já tiveram resultado (aceita ou negada) na janela.</p>
                                    <div class="d-flex align-items-baseline gap-2 mb-1">
                                        <span class="display-6 fw-bold text-${cor}">${a}%</span>
                                        <span class="text-muted small">aceitas ÷ (aceitas + negadas)</span>
                                    </div>
                                    <div class="progress mb-2" style="height:8px;">
                                        <div class="progress-bar bg-${cor}" style="width:${a}%"></div>
                                    </div>
                                    <div class="small mb-2">
                                        <span class="badge bg-success me-1">${aceitas} aceitas</span>
                                        <span class="badge bg-danger me-1">${negadas} negadas</span>
                                        <span class="text-muted">em ${base} com resultado</span>
                                    </div>
                                    <div class="small ${a >= meta ? 'text-success' : 'text-danger'}">
                                        <i class="fas fa-bullseye me-1"></i> Meta ${meta}% (mínimo do RA para aumento de cota).
                                        ${a >= meta ? ' Acima da meta.' : ` Faltam ${meta - a} pontos para a meta.`}
                                    </div>`;
                            })()}
                        </div>
                    </div>
                </div>
            </div>`;
    }

    // Curva de aprendizado semanal (12 semanas)
    const curva = r.curvaSemanal || [];
    if (curva.length) {
        const maxVol = Math.max(1, ...curva.map(s => s.coerentes + s.feedbacks));
        const barras = curva.map(s => {
            const hC = Math.round((s.coerentes / maxVol) * 100);
            const hF = Math.round((s.feedbacks / maxVol) * 100);
            return `
                <div class="text-center" style="flex:1; min-width:0;">
                    <div class="d-flex justify-content-center align-items-end gap-1" style="height:120px;">
                        <div class="bg-success rounded-top" style="width:8px; height:${hC}%; min-height:2px;" title="${s.coerentes} coerentes"></div>
                        <div class="bg-warning rounded-top" style="width:8px; height:${hF}%; min-height:2px;" title="${s.feedbacks} feedbacks"></div>
                    </div>
                    <div class="small"><span class="badge bg-${corPct(s.pctBons)}" style="font-size:.6rem;">${s.pctBons}%</span></div>
                    <div class="text-muted" style="font-size:.65rem;">${escAud(s.semana)}</div>
                </div>`;
        }).join('');
        html += `
            <div class="card border-0 shadow-sm mb-3">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap">
                        <h6 class="text-muted text-uppercase small fw-bold mb-0"><i class="fas fa-wave-square me-1"></i> Curva de aprendizado — últimas 12 semanas</h6>
                        <span class="small">
                            <span class="badge bg-success">coerentes</span>
                            <span class="badge bg-warning text-dark">feedbacks</span>
                            <span class="badge bg-info">% no padrão</span>
                        </span>
                    </div>
                    <div class="d-flex align-items-end gap-1">${barras}</div>
                    <p class="small text-muted mt-2 mb-0">A auditoria é recalculada a cada abertura (cache de 5 min) a partir da planilha, então a curva reflete sempre os dados mais recentes — uma leitura por semana já mostra a evolução da coerência.</p>
                </div>
            </div>`;
    }

    // Evolução por mês
    const meses = apr.porMes || [];
    if (meses.length) {
        const maxCoerentes = Math.max(1, ...meses.map(m => m.coerentes));
        const barras = meses.map(m => {
            const altura = Math.round((m.coerentes / maxCoerentes) * 100);
            return `
                <div class="text-center" style="flex:1;">
                    <div class="d-flex flex-column justify-content-end align-items-center" style="height:140px;">
                        <span class="small fw-bold text-info">${m.coerentes}</span>
                        <div class="bg-info rounded-top" style="width:60%; height:${altura}%; min-height:2px;" title="${m.coerentes} coerentes"></div>
                    </div>
                    <div class="small text-muted mt-1">${escAud(m.mes)}</div>
                    <div class="small"><span class="badge bg-${corPct(m.pctBons)}">${m.pctBons}%</span></div>
                </div>`;
        }).join('');
        html += `
            <div class="card border-0 shadow-sm mb-3 mt-2">
                <div class="card-body">
                    <h6 class="text-muted text-uppercase small fw-bold mb-3"><i class="fas fa-chart-line me-1"></i> Evolução do aprendizado (coerentes por mês · % no padrão atual)</h6>
                    <div class="d-flex align-items-end gap-2">${barras}</div>
                </div>
            </div>`;
    }

    // Qualidade da base + janelas
    const janelas = apr.janelas || [];
    const linhasJanela = janelas.map(j => `
        <tr>
            <td>${j.dias} dias</td>
            <td>${j.coerentesTotal}</td>
            <td class="text-success">${j.coerentesPadraoAtual}</td>
            <td class="text-danger">${j.coerentesForaPadrao}</td>
            <td>${j.feedbacksTotal}</td>
            <td><span class="badge bg-${corPct(j.pctBons)}">${j.pctBons}%</span></td>
        </tr>`).join('');
    const c = apr.coerentes || {};
    html += `
        <div class="row">
            <div class="col-lg-7 mb-3">
                <div class="card border-0 shadow-sm h-100">
                    <div class="card-body">
                        <h6 class="text-muted text-uppercase small fw-bold mb-3"><i class="fas fa-layer-group me-1"></i> Saúde da base por janela</h6>
                        <div class="table-responsive">
                            <table class="table table-sm align-middle mb-0">
                                <thead class="table-light">
                                    <tr><th>Janela</th><th>Coerentes</th><th>No padrão</th><th>Fora</th><th>Feedbacks</th><th>% bons</th></tr>
                                </thead>
                                <tbody>${linhasJanela}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-lg-5 mb-3">
                <div class="card border-0 shadow-sm h-100">
                    <div class="card-body">
                        <h6 class="text-muted text-uppercase small fw-bold mb-3"><i class="fas fa-triangle-exclamation me-1"></i> Pontos de atenção (coerentes do período)</h6>
                        ${linhaAtencao('Tom antigo (agradecimentos/desculpas)', c.tomAntigo, c.total)}
                        ${linhaAtencao('Cita norma sem constar na solução', c.legalSemSolucao, c.total)}
                        ${linhaAtencao('Não reflete a solução implementada', c.naoRefleteSolucao, c.total)}
                    </div>
                </div>
            </div>
        </div>`;

    // Distribuições
    html += `
        <div class="row">
            <div class="col-md-6 mb-3">
                <div class="card border-0 shadow-sm h-100"><div class="card-body">
                    ${tabelaDistribuicao(c.porTipo, 'Coerentes por tipo de solicitação')}
                </div></div>
            </div>
            <div class="col-md-6 mb-3">
                <div class="card border-0 shadow-sm h-100"><div class="card-body">
                    ${tabelaDistribuicao((apr.feedbacks || {}).porTipo, 'Feedbacks (correções) por tipo')}
                </div></div>
            </div>
        </div>`;

    // Moderações
    const am = mod.abaModeracoes || {};
    html += `
        <div class="card border-0 shadow-sm mb-3">
            <div class="card-body">
                <h6 class="text-muted text-uppercase small fw-bold mb-3"><i class="fas fa-shield-alt me-1"></i> Moderações no período</h6>
                <div class="row">
                    ${kpiCard(am.total ?? 0, 'Total', 'fa-list', 'primary')}
                    ${kpiCard(am.aprovadas ?? 0, 'Aprovadas', 'fa-check', 'success')}
                    ${kpiCard(am.pendentes ?? 0, 'Pendentes', 'fa-hourglass-half', 'warning')}
                    ${kpiCard(am.coerentesUtilizaveis ?? 0, 'Usáveis p/ aprendizado', 'fa-brain', 'info')}
                </div>
                <div class="row mt-2">
                    <div class="col-md-6">${tabelaDistribuicao(am.porStatus, 'Por status')}</div>
                    <div class="col-md-6">${tabelaDistribuicao((mod.abaAceitas || {}).porTema, 'Aceitas por tema')}</div>
                </div>
            </div>
        </div>`;

    // Recomendação
    if (apr.recomendacao) {
        html += `
            <div class="alert alert-info d-flex align-items-start">
                <i class="fas fa-lightbulb me-2 mt-1"></i>
                <div><strong>Diagnóstico do sistema de aprendizado:</strong><br>${escAud(apr.recomendacao)}</div>
            </div>`;
    }

    const tg = r.totaisGerais || {};
    html += `
        <div class="text-muted small mt-2">
            Base total na planilha: ${tg.coerentesPlanilha ?? 0} respostas coerentes e ${tg.feedbacksPlanilha ?? 0} feedbacks
            (${tg.coerentesAntesPeriodo ?? 0} coerentes anteriores ao período).
        </div>`;

    return html;
}

function linhaAtencao(label, valor, total) {
    valor = valor || 0;
    const p = total ? Math.round((valor / total) * 100) : 0;
    const cor = p >= 50 ? 'danger' : (p >= 20 ? 'warning' : 'success');
    return `
        <div class="mb-2">
            <div class="d-flex justify-content-between small">
                <span>${escAud(label)}</span>
                <span class="text-${cor} fw-bold">${valor} (${p}%)</span>
            </div>
            <div class="progress" style="height:6px;">
                <div class="progress-bar bg-${cor}" style="width:${p}%"></div>
            </div>
        </div>`;
}

// Log de inicialização
console.log('🚀 Velotax Bot - Funções exportadas para uso global');
console.log('📋 Configurações disponíveis:', window.velotaxConfig);
console.log('🔧 Para alterar configurações, use: window.velotaxBot.alterarConfiguracaoEmpresa()');
