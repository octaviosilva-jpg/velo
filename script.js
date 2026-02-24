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

// Sistema de histórico
let historicoStats = [];
const HISTORICO_KEY = 'velotax_historico_stats';

// Estatísticas globais do servidor
let estatisticasGlobais = {
    respostas_geradas: 0,
    respostas_coerentes: 0,
    moderacoes_geradas: 0,
    moderacoes_coerentes: 0,
    revisoes_texto: 0,
    explicacoes_geradas: 0
};

// Carregar estatísticas globais do servidor
async function carregarEstatisticasGlobais() {
    try {
        console.log('📊 Carregando estatísticas globais do servidor...');
        const response = await fetch('/api/estatisticas-globais');
        const data = await response.json();
        
        if (data.success) {
            console.log('📊 Dados recebidos do servidor:', data);
            estatisticasGlobais = data.estatisticas;
            console.log('✅ Estatísticas globais carregadas:', estatisticasGlobais);
            console.log('📅 Última atualização:', data.lastUpdated);
            atualizarEstatisticasNaInterface();
        } else {
            console.error('❌ Erro ao carregar estatísticas globais:', data.error);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar estatísticas globais:', error);
    }
}

// Atualizar estatísticas na interface
async function atualizarEstatisticasNaInterface() {
    console.log('🔄 Atualizando interface com estatísticas do dia');
    
    // Buscar estatísticas do dia atual da planilha
    try {
        const response = await fetch('/api/estatisticas-hoje');
        const data = await response.json();
        
        if (data.success) {
            // Atualizar contadores na interface com dados do dia
            const statItems = document.querySelectorAll('.stat-item');
            
            if (statItems.length >= 2) {
                // Primeiro item: Respostas Hoje
                const respostasValue = statItems[0].querySelector('.stat-value');
                if (respostasValue) {
                    respostasValue.textContent = data.respostas_geradas || 0;
                    console.log('📝 Respostas hoje atualizadas:', data.respostas_geradas);
                }
                
                // Segundo item: Moderações Hoje
                const moderacoesValue = statItems[1].querySelector('.stat-value');
                if (moderacoesValue) {
                    moderacoesValue.textContent = data.moderacoes_geradas || 0;
                    console.log('⚖️ Moderações hoje atualizadas:', data.moderacoes_geradas);
                }
            } else {
                console.log('⚠️ Elementos de estatísticas não encontrados');
            }
        } else {
            // Fallback para estatísticas globais se o endpoint falhar
            console.log('⚠️ Usando fallback para estatísticas globais');
            const statItems = document.querySelectorAll('.stat-item');
            
            if (statItems.length >= 2) {
                const respostasValue = statItems[0].querySelector('.stat-value');
                if (respostasValue) {
                    respostasValue.textContent = estatisticasGlobais.respostas_geradas || 0;
                }
                
                const moderacoesValue = statItems[1].querySelector('.stat-value');
                if (moderacoesValue) {
                    moderacoesValue.textContent = estatisticasGlobais.moderacoes_geradas || 0;
                }
            }
        }
    } catch (error) {
        console.error('❌ Erro ao buscar estatísticas do dia:', error);
        // Fallback para estatísticas globais
        const statItems = document.querySelectorAll('.stat-item');
        
        if (statItems.length >= 2) {
            const respostasValue = statItems[0].querySelector('.stat-value');
            if (respostasValue) {
                respostasValue.textContent = estatisticasGlobais.respostas_geradas || 0;
            }
            
            const moderacoesValue = statItems[1].querySelector('.stat-value');
            if (moderacoesValue) {
                moderacoesValue.textContent = estatisticasGlobais.moderacoes_geradas || 0;
            }
        }
    }
    
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
   - Baseie respostas nas cláusulas da CCB quando aplicável
   - Explique questões de chave Pix e exclusão de cadastro conforme políticas internas
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
    const observacoes = document.getElementById('observacoes-internas');
    
    console.log('🔍 Elementos encontrados:', {
        tipoSituacao: tipoSituacao ? 'OK' : 'NÃO ENCONTRADO',
        idReclamacao: idReclamacao ? 'OK' : 'NÃO ENCONTRADO',
        reclamacao: reclamacao ? 'OK' : 'NÃO ENCONTRADO',
        solucao: solucao ? 'OK' : 'NÃO ENCONTRADO',
        historico: historico ? 'OK' : 'NÃO ENCONTRADO',
        observacoes: observacoes ? 'OK' : 'NÃO ENCONTRADO'
    });
    
    if (!tipoSituacao || !idReclamacao || !reclamacao || !solucao) {
        console.error('❌ Elementos obrigatórios não encontrados!');
        showErrorMessage('Erro: Elementos do formulário não encontrados. Verifique se a página carregou corretamente.');
        return;
    }
    
    const tipoSituacaoValue = tipoSituacao.value;
    const idReclamacaoValue = idReclamacao.value.trim();
    const reclamacaoValue = reclamacao.value;
    const solucaoValue = solucao.value;
    const historicoValue = historico.value;
    const observacoesValue = observacoes.value;
    
    console.log('Dados coletados:', {
        tipoSituacao: tipoSituacaoValue,
        idReclamacao: idReclamacaoValue,
        reclamacao: reclamacaoValue.substring(0, 50) + '...',
        solucao: solucaoValue.substring(0, 50) + '...'
    });
    
    // Validação dos campos obrigatórios
    if (!tipoSituacaoValue || !idReclamacaoValue || !reclamacaoValue || (typeof reclamacaoValue === 'string' && !reclamacaoValue.trim()) || !solucaoValue || (typeof solucaoValue === 'string' && !solucaoValue.trim())) {
        console.log('Validação falhou - campos obrigatórios não preenchidos');
        showErrorMessage('Por favor, preencha todos os campos obrigatórios (*).');
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
            observacoes_internas: observacoesValue,
            timestamp: new Date().toISOString()
        };
        
        console.log('Chamando servidor...');
        
        // Chamar servidor para gerar resposta
        const resposta = await gerarRespostaRAViaAPI(dadosResposta);
        
        console.log('Resposta recebida:', resposta.substring(0, 100) + '...');
        
        // Exibir resposta
        document.getElementById('texto-resposta-gpt5').value = resposta;
        document.getElementById('resposta-gpt5').style.display = 'block';
        
        console.log('Resposta exibida na interface');
        
        // Salvar no histórico
        const itemHistorico = {
            id: Date.now(),
            dados: dadosResposta,
            resposta: resposta,
            status: 'gerada',
            timestamp: new Date().toISOString()
        };
        historicoRespostas.unshift(itemHistorico);
    
    // Recarregar estatísticas globais do servidor
    carregarEstatisticasGlobais();
    
        showSuccessMessage('Resposta gerada com sucesso pela IA OpenAI!');
        
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
            departamento: window.auth.dadosUsuario().departamento
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
            return data.result;
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
- Observações internas: ${dados.observacoes_internas || 'Nenhuma'}

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
        solucao_implementada: document.getElementById('solucao-implementada').value,
        historico_atendimento: document.getElementById('historico-atendimento').value,
        observacoes_internas: document.getElementById('observacoes-internas').value,
        timestamp: new Date().toISOString()
    };
    
    if (tipoAvaliacao === 'coerente') {
        console.log('✅ Marcando como coerente - iniciando salvamento');
        
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
            departamento: window.auth.dadosUsuario().departamento
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

// Função removida - funcionalidade obsoleta (substituída pelo modal de solicitações)
// function visualizarModelosSalvos() { ... }

// Função removida - funcionalidade obsoleta
// function limparModelosSalvos() { ... }

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
        departamento: window.auth.dadosUsuario().departamento
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

async function reformularRespostaOpenAI(dados, respostaAnterior) {
    // Prompt específico para reformulação
    const promptReformulacao = `${PROMPT_MASTER_OPENAI}

### Dados recebidos:
- Tipo de solicitação: ${dados.tipo_solicitacao}
- ID da Reclamação: ${dados.id_reclamacao}
- Reclamação do cliente: ${dados.texto_cliente}
- Solução implementada: ${dados.solucao_implementada}
- Histórico de atendimento: ${dados.historico_atendimento || 'Nenhum'}
- Observações internas: ${dados.observacoes_internas || 'Nenhuma'}

### Resposta anterior (incoerente):
${respostaAnterior}

### Instrução:
A resposta anterior foi considerada incoerente. Gere uma nova resposta corrigindo os erros identificados, consultando os manuais de moderação do RA, documentos internos da ${NOME_EMPRESA}, cláusulas da CCB e mantendo clareza, tom cordial e imparcialidade.

Gere a nova resposta:`;

    // Simular delay da API
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Gerar resposta reformulada (melhorada)
    return gerarRespostaReformulada(dados, respostaAnterior);
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
        document.getElementById('solucao-implementada').value = item.dados.solucao_implementada;
        document.getElementById('historico-atendimento').value = item.dados.historico_atendimento;
        document.getElementById('observacoes-internas').value = item.dados.observacoes_internas;
        
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
        solucao: document.getElementById('solucao-implementada').value,
        historico: document.getElementById('historico-atendimento').value,
        observacoes: document.getElementById('observacoes-internas').value,
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
    document.getElementById('solucao-implementada').value = rascunho.solucao;
    document.getElementById('historico-atendimento').value = rascunho.historico;
    document.getElementById('observacoes-internas').value = rascunho.observacoes;
    
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
        tipoSituacao: "exclusao-cadastro",
        idReclamacao: "RA-12345",
        reclamacaoCliente: `Cliente solicita exclusão de seu cadastro da ${NOME_EMPRESA}. Ele não quer mais receber comunicações e deseja que todos os seus dados sejam removidos dos sistemas.`,
        solucaoImplementada: "Cadastro excluído no sistema em 12/08/2025 conforme solicitação.",
        historicoAtendimento: "Cliente já havia solicitado exclusão via WhatsApp em 15/01/2025, mas não recebeu confirmação.",
        observacoesInternas: "Cliente demonstrou satisfação com o atendimento."
    },
    {
        nome: "Exclusão de Cadastro - Negada",
        tipoSituacao: "exclusao-cadastro",
        idReclamacao: "RA-12346",
        reclamacaoCliente: `Cliente solicita exclusão de seu cadastro da ${NOME_EMPRESA}. Ele não quer mais receber comunicações e deseja que todos os seus dados sejam removidos dos sistemas.`,
        solucaoImplementada: "Não foi possível realizar a exclusão do cadastro devido a pendências contratuais ativas.",
        historicoAtendimento: "Cliente possui operação em andamento que impede a exclusão.",
        observacoesInternas: "Explicar ao cliente sobre as pendências e como resolver."
    },
    {
        nome: "Liberação de Chave Pix - Realizada",
        tipoSituacao: "exclusao-chave-pix-cpf",
        idReclamacao: "RA-12347",
        reclamacaoCliente: "Cliente solicita liberação da chave Pix CPF para portabilidade. Ele quer transferir para outro banco.",
        solucaoImplementada: "Portabilidade da chave Pix concluída e confirmada em contato com o cliente.",
        historicoAtendimento: "Cliente já havia tentado fazer a portabilidade anteriormente.",
        observacoesInternas: "Processo realizado em 2 dias úteis conforme previsto."
    },
    {
        nome: "Liberação de Chave Pix - Negada",
        tipoSituacao: "exclusao-chave-pix-cpf",
        idReclamacao: "RA-12348",
        reclamacaoCliente: "Cliente solicita liberação da chave Pix CPF para portabilidade. Ele quer transferir para outro banco.",
        solucaoImplementada: "Não foi possível realizar a liberação da chave Pix devido a operação ativa.",
        historicoAtendimento: "Cliente possui antecipação em andamento que impede a liberação.",
        observacoesInternas: "Aguardar finalização da operação para liberar a chave."
    },
    {
        nome: "Quitação - Realizada",
        tipoSituacao: "quitacao",
        idReclamacao: "RA-12349",
        reclamacaoCliente: "Cliente questiona sobre quitação de antecipação. Ele acredita que já quitou mas ainda aparece débito.",
        solucaoImplementada: "Antecipação quitada automaticamente em 31/07/2025 quando restituição foi depositada pela Receita Federal.",
        historicoAtendimento: "Cliente recebeu restituição do IR em 31/07/2025.",
        observacoesInternas: "Sistema atualizado automaticamente após depósito da restituição."
    },
    {
        nome: "SERASA/SPC - Inclusão",
        tipoSituacao: "juros-abusivos",
        idReclamacao: "RA-12350",
        reclamacaoCliente: "Cliente questiona inclusão em SERASA/SPC. Ele não entende por que foi incluído.",
        solucaoImplementada: "Antecipação não foi quitada na data prevista, resultando em inclusão nos órgãos de proteção ao crédito.",
        historicoAtendimento: "Cliente não quitou a antecipação no prazo estabelecido.",
        observacoesInternas: "Explicar sobre descumprimento contratual e como regularizar."
    },
    {
        nome: "Análise em Andamento",
        tipoSituacao: "exclusao-cadastro",
        idReclamacao: "RA-12351",
        reclamacaoCliente: `Cliente solicita exclusão de seu cadastro da ${NOME_EMPRESA}. Ele não quer mais receber comunicações.`,
        solucaoImplementada: "Solicitação em análise pela equipe técnica. Aguardando verificação de pendências.",
        historicoAtendimento: "Cliente fez a solicitação há 2 dias úteis.",
        observacoesInternas: "Análise deve ser concluída em até 5 dias úteis."
    },
    {
        nome: "Juros Abusivos - Análise",
        tipoSituacao: "juros-abusivos",
        idReclamacao: "RA-12352",
        reclamacaoCliente: "Cliente reclama de juros abusivos na antecipação. Ele acredita que os valores estão incorretos.",
        solucaoImplementada: "Análise dos cálculos em andamento pela equipe financeira. Verificando aplicação das taxas contratuais.",
        historicoAtendimento: "Cliente questionou os valores há 3 dias úteis.",
        observacoesInternas: "Revisão completa dos cálculos e taxas aplicadas."
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
            'solucao-implementada': document.getElementById('solucao-implementada'),
            'historico-atendimento': document.getElementById('historico-atendimento'),
            'observacoes-internas': document.getElementById('observacoes-internas')
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
        elementos['historico-atendimento'].value = exemplo.historicoAtendimento;
        elementos['observacoes-internas'].value = exemplo.observacoesInternas;
        
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

function gerarRespostaReclameAqui(estagio, tipoSituacao, baseContratual, reclamacao, historico, solucao) {
    let resposta = '';
    
    // Saudação baseada no estágio
    const saudacoes = {
        'primeira-resposta': '<p><strong>Prezado(a) cliente,</strong></p>',
        'replica': '<p><strong>Prezado(a) cliente,</strong></p>',
        'fechamento': '<p><strong>Prezado(a) cliente,</strong></p>'
    };
    
    resposta += saudacoes[estagio] || saudacoes['primeira-resposta'];
    
    // Conteúdo baseado no tipo de situação selecionado
    switch (tipoSituacao) {
        case 'retirar-chave-pix':
            resposta += '<p>Informamos que sua solicitação de retirada de chave Pix foi processada conforme solicitado.</p>';
            resposta += '<p>O prazo para processamento é de até 2 dias úteis, conforme regulamentação do Banco Central.</p>';
            break;
        case 'exclusao-cadastro':
            resposta += '<p>Sua solicitação de exclusão de cadastro foi devidamente registrada em nossos sistemas.</p>';
            resposta += '<p>A exclusão será realizada em até 15 dias úteis, conforme previsto na LGPD.</p>';
            break;
        case 'exclusao-conta-celcoin':
            resposta += '<p>Informamos que sua solicitação de exclusão da conta Celcoin foi processada.</p>';
            resposta += '<p>O processo de exclusão será concluído em até 5 dias úteis.</p>';
            break;
        case 'pagamento-restituicao':
            resposta += '<p>O pagamento de sua restituição foi processado conforme solicitado.</p>';
            resposta += '<p>O valor será creditado em sua conta em até 3 dias úteis.</p>';
            break;
        case 'amortizacao':
            resposta += '<p>Sua solicitação de amortização foi devidamente registrada.</p>';
            resposta += '<p>O valor será aplicado conforme as condições contratuais estabelecidas.</p>';
            break;
        case 'calculadora':
            resposta += '<p>Informamos que nossa calculadora está disponível em nosso site para simulações.</p>';
            resposta += '<p>Para cálculos específicos, nossa equipe está disponível para orientações.</p>';
            break;
        case 'estorno-plano':
            resposta += '<p>O estorno de seu plano foi processado conforme solicitado.</p>';
            resposta += '<p>O valor será devolvido em até 10 dias úteis, conforme prazo estabelecido.</p>';
            break;
        case 'quitação':
            resposta += '<p>Conforme solicitado, a quitação antecipada foi processada com o desconto aplicável conforme as condições contratuais.</p>';
            break;
        case 'outro':
            resposta += '<p>Sua solicitação foi devidamente registrada em nossos sistemas.</p>';
            resposta += '<p>Nossa equipe está analisando o caso e entrará em contato em breve.</p>';
            break;
    }
    
    // Se há histórico de atendimento
    if (historico.trim()) {
        resposta += '<p>Conforme já havíamos encaminhado anteriormente, ';
        resposta += historico.toLowerCase() + '.</p>';
    }
    
    // Se há solução implementada
    if (solucao.trim()) {
        resposta += '<p>' + solucao + '.</p>';
    } else if (estagio === 'primeira-resposta') {
        resposta += '<p>Agradecemos seu contato e lamentamos pelo transtorno causado.</p>';
        resposta += '<p>Nossa equipe está analisando sua solicitação e tomaremos as medidas necessárias para resolver a situação.</p>';
    }
    
    // Fechamento baseado no estágio
    if (estagio === 'fechamento') {
        resposta += '<p>Consideramos este assunto encerrado e agradecemos sua compreensão.</p>';
    }
    
    resposta += '<p>Seguimos à disposição para ajudar.</p>';
    
    return resposta;
}

// Função para copiar resposta editada
function copiarRespostaEditada() {
    const textoEditavel = document.getElementById('texto-editavel').value;
    
    if (!textoEditavel || (typeof textoEditavel === 'string' && !textoEditavel.trim())) {
        showErrorMessage('Não há texto para copiar.');
        return;
    }
    
    navigator.clipboard.writeText(textoEditavel).then(() => {
        showSuccessMessage('Resposta editada copiada para a área de transferência!');
    }).catch(() => {
        showErrorMessage('Erro ao copiar texto.');
    });
}

// Função para limpar edição
function limparEdicao() {
    document.getElementById('texto-editavel').value = '';
    document.getElementById('edicao-rapida').style.display = 'none';
    document.getElementById('resposta-ra').style.display = 'none';
    showSuccessMessage('Edição limpa com sucesso!');
}

// ===== FUNÇÕES DE MODERAÇÃO =====

// Função para separar os dois blocos da resposta do servidor
function separarBlocosModeracao(resposta) {
    if (!resposta) return { linhaRaciocinio: '', textoFinal: '' };
    
    // Procurar por marcadores que indicam os blocos
    const marcadores = [
        '(1) LINHA DE RACIOCÍNIO INTERNA',
        '(2) TEXTO FINAL DE MODERAÇÃO',
        'LINHA DE RACIOCÍNIO INTERNA',
        'TEXTO FINAL DE MODERAÇÃO',
        '1. LINHA DE RACIOCÍNIO INTERNA',
        '2. TEXTO FINAL DE MODERAÇÃO'
    ];
    
    let linhaRaciocinio = '';
    let textoFinal = '';
    
    // Tentar separar por marcadores
    for (let i = 0; i < marcadores.length; i += 2) {
        const marcador1 = marcadores[i];
        const marcador2 = marcadores[i + 1];
        
        const index1 = resposta.indexOf(marcador1);
        const index2 = resposta.indexOf(marcador2);
        
        if (index1 !== -1 && index2 !== -1) {
            linhaRaciocinio = resposta.substring(index1 + marcador1.length, index2).trim();
            textoFinal = resposta.substring(index2 + marcador2.length).trim();
            break;
        }
    }
    
    // Se não encontrou marcadores, tentar separar por quebras de linha duplas
    if (!linhaRaciocinio && !textoFinal) {
        const partes = resposta.split('\n\n');
        if (partes.length >= 2) {
            linhaRaciocinio = partes[0].trim();
            textoFinal = partes.slice(1).join('\n\n').trim();
        } else {
            // Se não conseguiu separar, usar toda a resposta como texto final
            textoFinal = resposta;
        }
    }
    
    return { linhaRaciocinio, textoFinal };
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
    const idReclamacao = document.getElementById('id-reclamacao-moderacao').value.trim();
    const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
    const respostaEmpresa = document.getElementById('resposta-empresa').value;
    const motivoModeracao = document.getElementById('motivo-moderacao').value;
    const consideracaoFinal = document.getElementById('consideracao-final').value;
    
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
            // Processar a resposta que agora vem com dois blocos
            const resposta = data.result;
            
            // Separar os dois blocos da resposta
            const blocos = separarBlocosModeracao(resposta);
            
            // Usar a linha de raciocínio interna gerada pelo servidor
            const linhaRaciocinio = formatarLinhaRaciocinioServidor(blocos.linhaRaciocinio);
            
            // Usar o texto final de moderação gerado pelo servidor
            const textoModeracao = formatarTextoModeracao(blocos.textoFinal);
            
            document.getElementById('linha-raciocinio').innerHTML = linhaRaciocinio;
            document.getElementById('texto-moderacao').innerHTML = textoModeracao;
            document.getElementById('moderacao-resultado').style.display = 'block';
            
            // Recarregar estatísticas globais do servidor
            carregarEstatisticasGlobais();
            
            showSuccessMessage('Solicitação de moderação gerada com script estruturado!');
        } else {
            throw new Error(data.error || 'Erro ao gerar moderação');
        }
    } catch (error) {
        console.error('Erro ao gerar moderação:', error);
        showErrorMessage('Erro ao gerar moderação. Usando modelo local como fallback.');
        
        // Fallback para o modelo local
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

async function analisarChanceModeracao() {
    const reclamacaoCompleta = document.getElementById('reclamacao-completa').value;
    const respostaPublica = document.getElementById('resposta-publica').value;
    const consideracaoFinal = document.getElementById('consideracao-final').value;
    const historicoModeracao = document.getElementById('historico-moderacao').value;
    
    if (!reclamacaoCompleta.trim() || !respostaPublica.trim()) {
        showErrorMessage('Por favor, preencha a reclamação completa e a resposta pública da empresa.');
        return;
    }
    
    // Mostrar loading
    showLoadingMessage('Analisando chance de moderação com IA...');
    
    try {
        // Chamar endpoint do servidor
        const response = await fetch('/api/chance-moderacao', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reclamacaoCompleta: reclamacaoCompleta,
                respostaPublica: respostaPublica,
                consideracaoFinal: consideracaoFinal || '',
                historicoModeracao: historicoModeracao || ''
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Formatar e exibir a análise completa
            const analiseFormatada = formatarAnaliseChanceModeracao(data.result);
            
            document.getElementById('analise-chance-moderacao').innerHTML = analiseFormatada;
            document.getElementById('revisao-resultado').style.display = 'block';
            
            // Armazenar a resposta revisada para cópia separada e ajustes
            window.respostaRevisadaModeracao = extrairRespostaRevisada(data.result);
            window.analiseCompletaModeracao = data.result; // Armazenar análise completa para auditoria
            
            // Mostrar botão de ajuste manual se houver resposta revisada
            if (window.respostaRevisadaModeracao && window.respostaRevisadaModeracao.trim().length > 0) {
                document.getElementById('btn-ajuste-manual').style.display = 'inline-block';
            }
            
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

// Função para copiar apenas a resposta revisada
function copiarRespostaRevisada() {
    if (!window.respostaRevisadaModeracao) {
        showErrorMessage('Nenhuma resposta revisada disponível.');
        return;
    }
    
    navigator.clipboard.writeText(window.respostaRevisadaModeracao).then(() => {
        showSuccessMessage('Resposta revisada copiada para a área de transferência!');
    }).catch(err => {
        console.error('Erro ao copiar:', err);
        showErrorMessage('Erro ao copiar resposta revisada.');
    });
}

// Função para formatar a análise de chance de moderação
function formatarAnaliseChanceModeracao(analise) {
    if (!analise) return '';
    
    let html = '<div class="analise-chance-moderacao">';
    
    // Extrair informações de impacto antes de formatar
    const impactoInfo = extrairImpactoRevisao(analise);
    
    // Formatar o conteúdo preservando a estrutura do prompt
    let conteudoFormatado = analise
        .replace(/\n\n\n+/g, '\n\n')  // Múltiplas quebras = dupla quebra
        .replace(/\n\n/g, '</p><p>')  // Dupla quebra = novo parágrafo
        .replace(/\n/g, '<br>')       // Quebra simples = <br>
        .replace(/^/, '<p>')          // Iniciar com <p>
        .replace(/$/, '</p>');        // Terminar com </p>
    
    // Destacar seções principais
    conteudoFormatado = conteudoFormatado
        .replace(/📊 Análise da chance de moderação/gi, '<h5 class="text-primary mt-4 mb-3"><i class="fas fa-chart-line me-2"></i>📊 Chance de moderação (base)</h5>')
        .replace(/🧠 Fundamentação técnica/gi, '<h5 class="text-info mt-4 mb-3"><i class="fas fa-brain me-2"></i>🧠 Fundamentação técnica</h5>')
        .replace(/⚠️ Riscos de negativa/gi, '<h5 class="text-warning mt-4 mb-3"><i class="fas fa-exclamation-triangle me-2"></i>⚠️ Riscos de negativa</h5>')
        .replace(/🎯 Tese principal de moderação/gi, '<h5 class="text-success mt-4 mb-3"><i class="fas fa-bullseye me-2"></i>🎯 Tese principal de moderação</h5>')
        .replace(/🧩 Teses complementares/gi, '<h5 class="text-secondary mt-4 mb-3"><i class="fas fa-puzzle-piece me-2"></i>🧩 Teses complementares</h5>')
        .replace(/✍️ Revisão de Textos/gi, '<h5 class="text-dark mt-4 mb-3"><i class="fas fa-edit me-2"></i>✍️ Revisão de Textos (versão estratégica)</h5>')
        .replace(/📈 Impacto da revisão de texto/gi, '<h5 class="text-success mt-4 mb-3"><i class="fas fa-chart-line me-2"></i>📈 Impacto da revisão de texto</h5>')
        .replace(/🔍 Auditoria de Consistência da Resposta/gi, '<h5 class="text-warning mt-4 mb-3"><i class="fas fa-search me-2"></i>🔍 Auditoria de Consistência da Resposta</h5>')
        .replace(/Chance estimada: (\d+%)/gi, '<strong class="text-primary fs-4">Chance estimada: $1</strong>')
        .replace(/Classificação: (.+?)(<br>|<\/p>)/gi, '<span class="badge bg-info ms-2">$1</span>$2')
        .replace(/Antes da revisão: (\d+%)/gi, '<strong class="text-secondary">Antes da revisão: $1</strong>')
        .replace(/Após a revisão: (\d+%)/gi, '<strong class="text-success">Após a revisão: $1</strong>')
        .replace(/Variação estimada: ([+-]\d+%)/gi, '<strong class="text-primary">Variação estimada: $1</strong>');
    
    html += '<div class="alert alert-light border-start border-secondary border-4">';
    html += conteudoFormatado;
    html += '</div>';
    
    // Adicionar card destacado para o impacto se existir
    if (impactoInfo.temImpacto) {
        html += '<div class="card border-success mt-4">';
        html += '<div class="card-header bg-success text-white">';
        html += '<h6 class="mb-0"><i class="fas fa-chart-line me-2"></i>📈 Impacto da Revisão de Texto</h6>';
        html += '</div>';
        html += '<div class="card-body">';
        html += `<p class="mb-2"><strong>Chance antes da revisão:</strong> <span class="badge bg-secondary">${impactoInfo.antes}%</span></p>`;
        html += `<p class="mb-2"><strong>Chance após a revisão:</strong> <span class="badge bg-success">${impactoInfo.depois}%</span></p>`;
        html += `<p class="mb-3"><strong>Variação estimada:</strong> <span class="badge bg-primary">${impactoInfo.variacao}</span></p>`;
        if (impactoInfo.justificativa) {
            html += '<hr>';
            html += '<h6 class="text-info"><i class="fas fa-brain me-2"></i>🧠 Justificativa técnica</h6>';
            html += `<p class="text-muted">${impactoInfo.justificativa}</p>`;
        }
        html += '</div>';
        html += '</div>';
    }
    
    // Extrair e exibir auditoria de consistência
    const auditoriaInfo = extrairAuditoriaConsistencia(analise);
    if (auditoriaInfo.temAuditoria) {
        html += formatarAuditoriaConsistencia(auditoriaInfo);
    }
    
    html += '</div>';
    
    return html;
}

// Função para extrair informações de impacto da revisão
function extrairImpactoRevisao(analise) {
    if (!analise) return { temImpacto: false };
    
    const resultado = {
        temImpacto: false,
        antes: null,
        depois: null,
        variacao: null,
        justificativa: null
    };
    
    // Procurar pelo bloco de impacto (várias variações possíveis)
    const marcadoresImpacto = [
        '📈 Impacto da revisão de texto',
        'Impacto da revisão de texto',
        'IMPACTO DA REVISÃO'
    ];
    
    let marcadorImpacto = -1;
    for (const marcador of marcadoresImpacto) {
        const index = analise.indexOf(marcador);
        if (index !== -1) {
            marcadorImpacto = index;
            break;
        }
    }
    
    if (marcadorImpacto === -1) return resultado;
    
    resultado.temImpacto = true;
    
    // Extrair o texto do bloco de impacto
    const textoImpacto = analise.substring(marcadorImpacto);
    
    // Extrair chance antes (várias variações)
    const matchAntes = textoImpacto.match(/Antes da revisão:\s*(\d+)%/i) || 
                       textoImpacto.match(/Chance antes:\s*(\d+)%/i) ||
                       textoImpacto.match(/Antes:\s*(\d+)%/i);
    if (matchAntes) {
        resultado.antes = matchAntes[1];
    }
    
    // Extrair chance depois (várias variações)
    const matchDepois = textoImpacto.match(/Após a revisão:\s*(\d+)%/i) ||
                        textoImpacto.match(/Chance após:\s*(\d+)%/i) ||
                        textoImpacto.match(/Depois:\s*(\d+)%/i) ||
                        textoImpacto.match(/Após:\s*(\d+)%/i);
    if (matchDepois) {
        resultado.depois = matchDepois[1];
    }
    
    // Extrair variação (várias variações)
    const matchVariacao = textoImpacto.match(/Variação estimada:\s*([+-]\d+%)/i) ||
                          textoImpacto.match(/Variação:\s*([+-]\d+%)/i) ||
                          textoImpacto.match(/Diferença:\s*([+-]\d+%)/i);
    if (matchVariacao) {
        resultado.variacao = matchVariacao[1];
    }
    
    // Extrair justificativa
    const marcadoresJustificativa = [
        '🧠 Justificativa técnica',
        'Justificativa técnica',
        'JUSTIFICATIVA TÉCNICA'
    ];
    
    let marcadorJustificativa = -1;
    for (const marcador of marcadoresJustificativa) {
        const index = textoImpacto.indexOf(marcador);
        if (index !== -1) {
            marcadorJustificativa = index;
            break;
        }
    }
    
    if (marcadorJustificativa !== -1) {
        // Encontrar qual marcador foi usado
        let marcadorUsado = '';
        for (const marcador of marcadoresJustificativa) {
            if (textoImpacto.includes(marcador)) {
                marcadorUsado = marcador;
                break;
            }
        }
        let justificativa = textoImpacto.substring(marcadorJustificativa + marcadorUsado.length).trim();
        // Remover marcadores seguintes
        const proximosMarcadores = ['🧠', '📊', '⚠️', '🎯', '🧩', '✍️', '📈', '🧭'];
        for (const marcador of proximosMarcadores) {
            const index = justificativa.indexOf(marcador);
            if (index !== -1 && index > 50) { // Só remover se não for no início (pode ser parte do texto)
                justificativa = justificativa.substring(0, index).trim();
            }
        }
        // Limpar e limitar tamanho
        justificativa = justificativa.replace(/^\s*[-•]\s*/gm, '').trim();
        resultado.justificativa = justificativa.substring(0, 800); // Limitar tamanho
    }
    
    return resultado;
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

// Função para separar os blocos da resposta de revisão
function separarBlocosRevisao(resposta) {
    if (!resposta) return { linhaRaciocinio: '', textoRevisado: '' };
    
    // Procurar por marcadores que indicam os blocos
    const marcadores = [
        '(1) LINHA DE RACIOCÍNIO INTERNA',
        '(2) TEXTO REVISADO',
        'LINHA DE RACIOCÍNIO INTERNA',
        'TEXTO REVISADO',
        '1. LINHA DE RACIOCÍNIO INTERNA',
        '2. TEXTO REVISADO'
    ];
    
    let linhaRaciocinio = '';
    let textoRevisado = '';
    
    // Tentar separar por marcadores
    for (let i = 0; i < marcadores.length; i += 2) {
        const marcador1 = marcadores[i];
        const marcador2 = marcadores[i + 1];
        
        const index1 = resposta.indexOf(marcador1);
        const index2 = resposta.indexOf(marcador2);
        
        if (index1 !== -1 && index2 !== -1) {
            linhaRaciocinio = resposta.substring(index1 + marcador1.length, index2).trim();
            textoRevisado = resposta.substring(index2 + marcador2.length).trim();
            break;
        }
    }
    
    // Se não encontrou os marcadores, tentar separar por quebras de linha
    if (!linhaRaciocinio && !textoRevisado) {
        const linhas = resposta.split('\n');
        let encontrouPrimeiro = false;
        
        for (let i = 0; i < linhas.length; i++) {
            const linha = linhas[i].trim();
            if (linha.includes('LINHA DE RACIOCÍNIO') || linha.includes('raciocínio')) {
                encontrouPrimeiro = true;
                continue;
            }
            if (linha.includes('TEXTO REVISADO') || linha.includes('revisado')) {
                encontrouPrimeiro = false;
                continue;
            }
            
            if (encontrouPrimeiro) {
                linhaRaciocinio += linha + '\n';
            } else {
                textoRevisado += linha + '\n';
            }
        }
    }
    
    return {
        linhaRaciocinio: linhaRaciocinio.trim(),
        textoRevisado: textoRevisado.trim()
    };
}

// Função para formatar a linha de raciocínio da revisão
function formatarLinhaRaciocinioRevisao(linhaRaciocinio) {
    if (!linhaRaciocinio) return '';
    
    let linha = '<div class="linha-raciocinio revisao">';
    linha += '<h6 class="text-info mb-3"><i class="fas fa-brain me-2"></i>Linha de Raciocínio da Revisão:</h6>';
    
    // Formatar o conteúdo da linha de raciocínio
    let conteudoFormatado = linhaRaciocinio
        .replace(/\n\n/g, '</p><p>')  // Dupla quebra de linha = novo parágrafo
        .replace(/\n/g, '<br>')       // Quebra simples = <br>
        .replace(/^/, '<p>')          // Iniciar com <p>
        .replace(/$/, '</p>');        // Terminar com </p>
    
    // Destacar elementos importantes
    conteudoFormatado = conteudoFormatado
        .replace(/Padronização/gi, '<strong class="text-primary">Padronização</strong>')
        .replace(/Clareza/gi, '<strong class="text-success">Clareza</strong>')
        .replace(/Compliance/gi, '<strong class="text-warning">Compliance</strong>')
        .replace(/Estrutura/gi, '<strong class="text-info">Estrutura</strong>')
        .replace(/LGPD/gi, '<strong class="text-danger">LGPD</strong>')
        .replace(/CCB/gi, '<strong class="text-secondary">CCB</strong>');
    
    linha += '<div class="alert alert-light border-start border-info border-4">';
    linha += conteudoFormatado;
    linha += '</div>';
    linha += '</div>';
    
    return linha;
}

// Função para formatar o texto revisado
function formatarTextoRevisado(texto) {
    if (!texto) return '';
    
    // Quebrar o texto em parágrafos baseado em quebras de linha
    let textoFormatado = texto
        .replace(/\n\n/g, '</p><p>')  // Dupla quebra de linha = novo parágrafo
        .replace(/\n/g, '<br>')       // Quebra simples = <br>
        .replace(/^/, '<p>')          // Iniciar com <p>
        .replace(/$/, '</p>');        // Terminar com </p>
    
    // Destacar frases importantes
    textoFormatado = textoFormatado
        .replace(/Prezado\(a\)/g, '<strong>Prezado(a)</strong>')
        .replace(/Atenciosamente/g, '<strong>Atenciosamente</strong>')
        .replace(new RegExp(`Equipe ${NOME_EMPRESA}`, 'g'), `<strong>Equipe ${NOME_EMPRESA}</strong>`);
    
    return textoFormatado;
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
                contexto: contexto
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


// ===== FUNÇÕES DE FAQ & COMPLIANCE =====

function gerarFAQ() {
    const tema = document.getElementById('tema-faq').value;
    
    if (!tema) {
        showErrorMessage('Por favor, selecione o tema.');
        return;
    }
    
    const respostaFAQ = gerarRespostaFAQ(tema);
    
    document.getElementById('faq-content').innerHTML = respostaFAQ;
    document.getElementById('faq-resultado').style.display = 'block';
    
    showSuccessMessage('Resposta FAQ gerada com sucesso!');
}

function gerarRespostaFAQ(tema) {
    const respostas = {
        'servicos-velotax': `
            <p><strong>Pergunta:</strong> 'Quais são os serviços oferecidos pelo Velotax?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>O Velotax é uma empresa de tecnologia focada em criar soluções que simplificam o cálculo e o pagamento de impostos Pessoa Física e agora oferece soluções de crédito de maneira simples e rápida. Somos o maior aplicativo de antecipação do país, com mais de 3 milhões de downloads, 📲 oferecendo os serviços abaixo:</p>
            
            <p><strong>💸 Antecipação da Restituição:</strong> Para facilitar ainda mais, oferecemos a opção de antecipação da sua restituição de Imposto de Renda. Em até 48 horas ⏳, o valor estará na sua conta, sem burocracia e sem enrolação. Com o Velotax, você tem praticidade, segurança e velocidade🚀, tudo em um só lugar.</p>
            
            <p><strong>📝 Envio do IRPF:</strong> Nosso serviço de envio de declaração de Imposto de Renda é rápido, fácil ✅ e intuitivo. A plataforma do Velotax guia você passo a passo para garantir o preenchimento correto e eficiente da sua declaração de Imposto de Renda Pessoa Física com rapidez e segurança! Em apenas alguns minutos, você pode declarar seu Imposto de Renda com 100% de precisão.</p>
            
            <p><strong>👷‍♂️ Crédito do Trabalhador:</strong> Empréstimo consignado para trabalhadores CLT, domésticos e diretores, com vínculo ativo mínimo de 12 meses e pagamento descontado diretamente na folha de pagamento pelo e-Social. O processo é 100% digital, com juros menores, liberação rápida via Pix e carência de até 92 dias no primeiro vencimento.</p>
            
            <p><strong>💰 Crédito Pessoal:</strong> É um empréstimo em dinheiro que você pode usar como quiser para pagar dívidas, ou fazer compras. O pagamento é feito em parcelas com juros, e todo o processo é 100% digital pelo aplicativo. A análise é rápida via Open Finance e o valor pode ser liberado em até 24 horas. As propostas são atualizadas diariamente, aumentando suas chances de conseguir uma oferta adequada ao seu perfil.</p>
            
            <p><strong>📌 Veloprime, nossa Calculadora de DARF:</strong> Cálculo automático preciso de impostos, além de emissão de DARF. Tudo o que você precisa para investir com mais segurança 📈 sem se preocupar com os impostos. Nossa ferramenta é completa, integrando informações da B3 e exterior 🌍.</p>
        `,
        'antecipacao-restituicao': `
            <p><strong>Pergunta:</strong> 'Qual é o serviço de Antecipação da Restituição oferecido pelo Velotax?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>Durante o período de declaração do Imposto de Renda💰, que ocorre normalmente entre Março e Maio de cada ano📅, o Velotax 📲 oferece aos clientes o serviço de Antecipação da Restituição. Ao declarar seu Imposto de Renda conosco e confirmar que possui saldo a restituir, você tem a opção de antecipar parte desse valor de forma rápida e segura.</p>
            
            <p>A principal vantagem desse serviço é a agilidade🚀: a antecipação é feita em minutos, sem burocracia ou análise de crédito. O valor antecipado é creditado diretamente na sua conta e, quando a Receita Federal libera sua restituição, o montante é utilizado para quitar a antecipação automaticamente✅.</p>
            
            <p>📢 O período de entrega da declaração de 2025 já foi encerrado, mas você ainda pode contar com o Velotax para realizar a antecipação da restituição do Imposto de Renda. Nosso processo é simples, rápido e seguro🔒, garantindo que você tenha acesso ao valor antes do crédito da Receita Federal.</p>
            
            <p>Fique atento ao nosso aplicativo e redes sociais para mais novidades! 🚀💙</p>
        `,
        'credito-trabalhador': `
            <p><strong>Pergunta:</strong> 'Crédito do Trabalhador Velotax: O que é?'}</p>
            <p><strong>Resposta:</strong></p>
            <p><strong>👷‍♂️ Crédito do Trabalhador Velotax: O que é o Crédito do Trabalhador?</strong> Empréstimo consignado lançado em 2025 📅 para trabalhadores CLT, domésticos e diretores, com vínculo ativo mínimo de 12 meses e empresa ativa há 24 meses. Pagamento com desconto diretamente na folha de pagamento pelo e-Social.</p>
            
            <p><strong>Quais os diferenciais de contratar com o Velotax?</strong> Juros menores, troca de dívidas mais caras, processo 100% digital 💻, liberação via Pix CPF e carência de até 92 dias no 1º vencimento.</p>
            
            <p><strong>Como contratar o serviço?</strong> Acesse o app Velotax, autorize a Consulta de Margem, valide informações, assine o contrato digitalmente ✍️ e receba o crédito via Pix em até 24 horas.</p>
            
            <p><strong>Quais documentos são necessários?</strong> Você realizará um processo de confirmação de identidade onde enviará uma foto ou exportação da carteira digital de seu documento de identidade ✍️, e uma selfie para garantir que você mesmo esteja fazendo a solicitação.</p>
        `,
        'credito-pessoal': `
            <p><strong>Pergunta:</strong> 'Crédito Pessoal Velotax: O que é?'}</p>
            <p><strong>Resposta:</strong></p>
            <p><strong>💰 Crédito Pessoal Velotax: O que é o Empréstimo Pessoal?</strong></p>
            <p>O Empréstimo Pessoal é uma linha de crédito concedida a pessoas físicas por instituições financeiras. Nessa modalidade, o cliente recebe um valor e o paga em parcelas mensais com juros, sem a necessidade de oferecer garantias ou justificar o uso do dinheiro. Esse tipo de crédito oferece flexibilidade e praticidade, podendo ser utilizado para diferentes finalidades, como quitar dívidas, investir em educação, cobrir emergências ou realizar projetos pessoais.</p>
            
            <p><strong>📋 Características do Produto:</strong></p>
            <ul>
                <li><strong>Valor do limite:</strong> R$ 500,00</li>
                <li><strong>Parcelamento:</strong> 4 parcelas, com vencimento a cada 30 dias</li>
                <li><strong>Data de vencimento:</strong> Definida automaticamente, com base na movimentação financeira do cliente via Open Finance</li>
                <li><strong>Taxa de juros:</strong> 19% a.m. (nesta versão inicial)</li>
                <li><strong>Faixa etária:</strong> 18 a 75 anos para todos os clientes</li>
            </ul>
            
            <p><strong>🔗 O que é Open Finance?</strong></p>
            <p>O Open Finance é como se fosse uma "ponte segura" que conecta diferentes bancos e instituições financeiras. Ele permite que você, com a sua autorização, compartilhe suas informações financeiras (como saldo, histórico de movimentações ou limites de crédito) de um banco para outro. Assim, os bancos passam a ter uma visão mais completa do seu perfil financeiro, ajudando a oferecer melhores condições de crédito, taxas mais baixas e serviços personalizados.</p>
            
            <p><strong>📱 Como contratar o serviço?</strong></p>
            <p>O processo é 100% digital, feito diretamente no aplicativo Velotax:</p>
            <ol>
                <li>Acesse o aplicativo Velotax e seleciona o ícone do Empréstimo Pessoal na tela inicial</li>
                <li>Autorize a conexão com o Open Finance para análise de crédito</li>
                <li>Se aprovado, visualize o limite disponível (R$ 500,00)</li>
                <li>Revise a proposta com todas as condições (valor, juros, parcelas)</li>
                <li>Leia a CCB (Contrato de Crédito Bancário) e assine digitalmente</li>
                <li>O valor será creditado na sua conta entre 30 minutos e 24 horas</li>
            </ol>
            
            <p><strong>✨ Diferenciais de contratar com o Velotax:</strong></p>
            <ul>
                <li>Análise rápida via Open Finance (até 5 minutos) ⏱️</li>
                <li>Liberação do valor entre 30 minutos e 24 horas</li>
                <li>Processo 100% digital, sem burocracia</li>
                <li>Acompanhamento completo pelo aplicativo</li>
                <li>Sem necessidade de biometria ou envio de documentos adicionais (nesta versão inicial)</li>
            </ul>
            
            <p><strong>🏦 Bancos disponíveis:</strong><br>
            Nubank, Itaú (Pessoa Física), Bradesco (Pessoa Física), Santander (Pessoa Física), Banco do Brasil, Caixa Econômica e Inter.</p>
            
            <p><strong>💳 Como quitar o empréstimo?</strong><br>
            Acesse o app Velotax, vá até "Próximos Pagamentos", selecione "Crédito Pessoal" e escolha pagar via PIX (preferencial) ou cartão de crédito (principalmente para clientes em atraso).</p>
            
            <p><strong>🚫 Cancelamento:</strong><br>
            O cliente pode solicitar o cancelamento em até 7 dias após a contratação, devolvendo o valor integral via PIX. Após esse prazo, não será mais possível cancelar.</p>
            
            <p><strong>⚠️ Importante:</strong></p>
            <ul>
                <li>Não é permitido ter mais de um contrato ativo ao mesmo tempo</li>
                <li>Clientes com Crédito do Trabalhador ou débitos de Antecipação IRPF precisam quitar esses produtos antes</li>
                <li>Em caso de atraso: multa de 2% e encargos de 1% ao mês</li>
                <li>Caso o atraso não seja regularizado, o contrato poderá ser enviado aos órgãos de proteção ao crédito</li>
            </ul>
            
            <p><strong>📄 Documentos necessários:</strong><br>
            Não é necessário enviar documentos. Basta ter o CPF cadastrado como chave PIX na conta bancária e autorizar o compartilhamento dos dados pelo app.</p>
        `,
        'veloprime': `
            <p><strong>Pergunta:</strong> 'Veloprime: Calculadora e DARF do Velotax: O que é?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>A Calculadora de DARF Velotax é uma ferramenta desenvolvida para facilitar a vida de investidores que atuam na bolsa de valores e em investimentos internacionais. Ela gera automaticamente suas DARFs de imposto sobre ganhos em bolsa de forma altamente precisa, com base em um sistema conectado diretamente à B3, além de possuir integração com investimentos internacionais das corretoras internacionais da BTG e Warren, permitindo que você centralize seus cálculos e relatórios em um só lugar.</p>
            
            <p><strong>❌ Cancelamento do Plano</strong><br>
            Você pode solicitar o cancelamento dentro de 7 dias a partir do início do uso da plataforma, com estorno integral dos valores pagos, desde que não tenham sido feitas emissões de DARFs ou relatórios durante esse período.</p>
            
            <p><strong>Como solicitar o cancelamento:</strong></p>
            <p><strong>🔹 📱 Pelo aplicativo Velotax:</strong></p>
            <ol>
                <li>Acesse Início e clique em Ajuda (ícone ❓ no topo do app).</li>
                <li>Escolha a opção desejada: Falar no telefone, perguntar ao nosso Chatbot ou abrir chamado (nosso time responderá por e-mail).</li>
            </ol>
            <p><strong>🔹 📄 Formulário Web:</strong> [Clique aqui] para abrir um chamado rapidamente.</p>
            
            <p><strong>🔄 Cancelamento da Renovação Automática</strong><br>
            Os planos da Calculadora Velotax são renovados automaticamente para sua conveniência. Caso queira desativar a renovação, siga os passos no app: 1️⃣ Impostos > DARFs para investidores > Clique no menu do lado esquerdo (≡) > Desça até Conta > Dados do Plano > Cancelar Recorrência.</p>
            
            <p><strong>Ainda precisa de ajuda?</strong><br>
            <strong>📞 Atendimento Telefônico:</strong> (Disponível de segunda à sexta, das 08h00 às 19h00 e aos sábados, das 09h00 às 15h00)<br>
            📍 3003 7293 – Capitais e regiões metropolitanas<br>
            📍 0800 800 0049 – Demais localidades</p>
        `,
        'login-cadastro': `
            <p><strong>Pergunta:</strong> 'Como faço login ou criar uma conta no aplicativo Velotax?'}</p>
            <p><strong>Resposta:</strong></p>
            <p><strong>Dificuldade de cadastro</strong><br>
            Para acessar sua conta no Velotax, siga os passos abaixo:</p>
            
            <p>Se você já tem o app e a conta no Velotax, basta informar seu CPF e senha para acessar! Se seu dispositivo possui essa função, você pode fazer login de forma muito mais prática e segura usando a biometria!</p>
            
            <p><strong>Criando uma conta</strong></p>
            <p>Se ainda não tiver, faça o download do Velotax na App Store (iOS) ou Google Play Store (Android). Clique aqui para baixar</p>
            
            <ol>
                <li>Abra o aplicativo e clique em "Começar".</li>
                <li>Se for seu primeiro acesso, crie sua conta com seu cpf e número de celular. Confirme o acesso com o SMS enviado.</li>
                <li>Informe seu melhor e-mail e defina uma senha.</li>
                <li>Pronto! Você criou sua conta rápido e fácil!!</li>
            </ol>
        `,
        'malha-fina': `
            <p><strong>Pergunta:</strong> 'O que é a malha fina e como saber se minha declaração está retida?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>A malha fina ocorre quando a Receita Federal encontra inconsistências, erros ou falta de informações na sua declaração de Imposto de Renda. Isso pode acontecer, por exemplo, quando os dados fornecidos não correspondem ao que consta nas bases de dados da Receita📊, ou quando há divergências nos valores declarados.</p>
            
            <p><strong>Veja alguns motivos para cair na malha fina:</strong></p>
            <ul>
                <li>❌ erros de digitação;</li>
                <li>💲apresentação incorreta ou ilegítima de valores;</li>
                <li>📉 omissão de rendimento(s);</li>
                <li>📝 erros ou ausência de informações de cadastro;</li>
                <li>👨‍👩‍👧 inclusão irregular de dependentes da declaração ou omissão de seus rendimentos;</li>
                <li>🏥 incompatibilidade nas despesas médicas apresentadas; e</li>
                <li>📑 informações divergentes das informações da fonte pagadora.</li>
            </ul>
            
            <p>Para evitar cair na malha fina, é fundamental prestar muita atenção ao preenchimento de todos os campos da sua declaração. Verifique se os valores de rendimentos, deduções e investimentos foram informados corretamente ✅, e se todos os comprovantes necessários estão em ordem. O cuidado com esses detalhes ajuda a evitar problemas futuros.</p>
            
            <p>Caso sua declaração seja retida na malha fina, você pode verificar essa informação diretamente no aplicativo Velotax 📲 ou no site da Receita Federal clicando aqui.</p>
            
            <p>Lembre-se⚠️: se houver pendências, será necessário regularizar a situação junto à Receita Federal para desbloquear a restituição ou evitar multas</p>
        `,
        'envio-gratuito': `
            <p><strong>Pergunta:</strong> 'O envio da declaração pelo app Velotax é gratuito?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>O Velotax 📲 oferece uma plataforma simples e segura 🔒 para o preenchimento e envio da sua declaração de Imposto de Renda. Nosso serviço inclui verificação automática dos dados, suporte para esclarecer dúvidas 💬 e a facilidade de envio direto pelo aplicativo, garantindo que todo o processo seja realizado de forma correta e eficiente.</p>
            
            <p>A taxa de serviço💵 é cobrada para cobrir os benefícios oferecidos aos nossos clientes e o valor é sempre informado antes da conclusão do envio da declaração. Além disso, o pagamento é realizado apenas quando você recebe a restituição do Imposto de Renda 💸, mas você também tem a opção de pagar na hora, se preferir.</p>
        `,
        'restituicao-pendente': `
            <p><strong>Pergunta:</strong> 'Porque ainda não recebi minha restituição?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>A restituição do Imposto de Renda 💰 é paga em lotes, conforme o cronograma definido pela Receita Federal. Em 2025, foram 5 📅 lotes, distribuídos entre Maio e Setembro.</p>
            
            <p>Você pode acompanhar o status da sua restituição pelo aplicativo Velotax📲, acessando a opção "Consultar Restituição", ou diretamente no site da Receita Federal Consulta Restituição.</p>
            
            <p><strong>🔎 Ao consultar, preste atenção ao status da sua declaração:</strong></p>
            <p>"No banco de dados", "Em processamento" ou "Em fila de restituição"⏳: significa que a sua declaração ainda não foi incluída em um lote de pagamento, e é necessário aguardar a liberação.</p>
            
            <p>"Com Pendência", indica que sua declaração apresenta irregularidades ou foi retida na malha fina. Nesse caso, será necessário regularizar a situação diretamente no site (acesse aqui), pois a restituição ficará bloqueada até que as pendências sejam resolvidas. ➡️Para maiores informações, acesse nossa FAQ: "O que é a malha fina e como saber se minha declaração está retida?"</p>
            
            <p><strong>📌Se Você contratou o serviço de antecipação da restituição com o Velotax:</strong><br>
            Quando você optou por contratar a antecipação da sua restituição de IRPF, foram exibidos dois valores na tela:</p>
            <ul>
                <li><strong>💵 Valor antecipado:</strong> Esse é o valor líquido que você recebeu imediatamente após a aprovação da antecipação.</li>
                <li><strong>⏰ Valor em prazo normal:</strong> Esse seria o valor total que você receberia caso esperasse o pagamento conforme o calendário da Receita Federal.</li>
            </ul>
            
            <p>O valor que você recebeu como antecipação já estava líquido, ou seja, após a dedução dos custos de operação da plataforma e da linha de crédito utilizada para liberar o valor. O valor restante, que normalmente seria pago posteriormente, foi retido para cobrir esses custos operacionais e a operação de crédito.</p>
            
            <p>✅ Assim, após a antecipação, não há mais valores pendentes a receber, pois a diferença foi utilizada para cobrir as despesas relacionadas à operação do serviço de antecipação.</p>
        `,
        'restituicao-resgate': `
            <p><strong>Pergunta:</strong> 'Restituição do Imposto de Renda disponível para resgate'}</p>
            <p><strong>Resposta:</strong></p>
            <p>Se você está esperando a restituição do Imposto de Renda e o valor ainda não apareceu na sua conta, não precisa se preocupar! Em algumas situações, o valor pode não ter sido creditado diretamente na conta cadastrada e, nesse caso, fica disponível para resgate manual no site do Banco do Brasil.</p>
            
            <p><strong>❗Ficou com alguma dúvida? 💙</strong><br>
            Não se preocupe, a equipe Velotax está aqui para te ajudar! É só entrar em contato que vamos te acompanhar de pertinho, passo a passo, com todo o suporte que você precisar. 👉 Siga as orientações neste link.</p>
        `,
        'open-finance': `
            <p><strong>Pergunta:</strong> 'O que é Open Finance?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>Open Finance é um jeito seguro de você compartilhar seus dados financeiros entre bancos e outras instituições, sempre com a sua permissão. 🔒</p>
            
            <p>Na prática, isso permite juntar em um só lugar informações de contas, cartões, investimentos e empréstimos. Assim, fica muito mais fácil entender e organizar sua vida financeira.</p>
            
            <p>Com esse compartilhamento, os bancos e financeiras conseguem entender melhor o seu perfil e, assim, oferecer produtos e serviços mais personalizados como crédito, investimentos ou seguros, muitas vezes com condições mais justas e vantajosas do que as oferecidas de forma padrão.</p>
            
            <p>O mais importante: você tem total controle. ✅ Só compartilhe se quiser e pode cancelar a autorização a qualquer momento.</p>
        `,
        'suporte': `
            <p><strong>Pergunta:</strong> 'Como obter suporte no Velotax? Como falar com um atendente?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>Se precisar de ajuda, não hesite em ligar para a equipe Velotax 📞 teremos prazer em te atender e te orientar passo a passo!</p>
            
            <p>Se preferir, você também pode consultar nossa FAQ no Reclame Aqui, onde encontrará respostas rápidas para as dúvidas mais comuns 💙.</p>
            
            <p>Caso ainda precise de suporte, você pode entrar em contato conosco pelos seguintes canais:</p>
            
            <p><strong>🔹 📞 Atendimento Telefônico:</strong> (Disponível de segunda à sexta, das 08h00 às 19h00 e aos sábados, das 09h00 às 15h00)<br>
            📍 3003 7293 – Capitais e regiões metropolitanas<br>
            📍 0800 800 0049 – Demais localidades</p>
            
            <p><strong>🔹 📱 Pelo aplicativo Velotax:</strong><br>
            1️⃣ Acesse Início e cliente em Ajuda (ícone ❓ no topo do app).<br>
            2️⃣ Escolha a opção que preferir, Falar no telefone, perguntar ao nosso Chatbot ou abrir chamado por lá que nosso time te responde por e-mail. Simples assim!</p>
            
            <p><strong>🔹 📄 Formulário Web:</strong> [Clique aqui] para abrir um chamado rapidamente.</p>
            
            <p><strong>🔹 💻 Pelo Reclame Aqui:</strong><br>
            Na página inicial do Velotax no Reclame Aqui, clique em "Ir para o atendimento".</p>
            
            <p>Estamos aqui para ajudar! 😊</p>
        `
    };
    
    return respostas[tema] || '<p>Resposta não disponível para este tema.</p>';
}

// ===== FUNÇÕES DE MODERAÇÃO DE NOTAS =====

function gerarModeracaoNotas() {
    const avaliacao = document.getElementById('avaliacao-cliente').value;
    const solucaoRealizada = document.getElementById('solucao-realizada').value;
    const inconsistencias = document.getElementById('inconsistencias').value;
    
    if (!avaliacao.trim() || !solucaoRealizada.trim()) {
        showErrorMessage('Por favor, preencha a avaliação do cliente e a solução realizada.');
        return;
    }
    
    const moderacao = gerarSolicitacaoModeracaoNotas(avaliacao, solucaoRealizada, inconsistencias);
    
    document.getElementById('moderacao-notas-content').innerHTML = moderacao;
    document.getElementById('moderacao-notas-resultado').style.display = 'block';
    
    showSuccessMessage('Solicitação de moderação de notas gerada com sucesso!');
}

function gerarSolicitacaoModeracaoNotas(avaliacao, solucaoRealizada, inconsistencias) {
    let moderacao = '<p><strong>Solicitação de Moderação de Notas</strong></p>';
    
    moderacao += '<p>Prezados,</p>';
    moderacao += '<p>Solicitamos a moderação da avaliação acima pelos seguintes motivos:</p>';
    
    moderacao += '<p><strong>Avaliação do Cliente:</strong></p>';
    moderacao += `<p>${avaliacao}</p>`;
    
    moderacao += '<p><strong>Solução Realmente Realizada:</strong></p>';
    moderacao += `<p>${solucaoRealizada}</p>`;
    
    if (inconsistencias.trim()) {
        moderacao += '<p><strong>Inconsistências Identificadas:</strong></p>';
        moderacao += `<p>${inconsistencias}</p>`;
    }
    
    moderacao += '<p>A nota atribuída não condiz com a solução real implementada pela empresa.</p>';
    moderacao += '<p>Solicitamos a anulação da avaliação para não prejudicar nossa reputação.</p>';
    
    moderacao += '<p>Agradecemos a atenção.</p>';
    
    return moderacao;
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
        const consideracaoFinal = document.getElementById('consideracao-final').value;
        
        const linhaRaciocinio = document.getElementById('linha-raciocinio').innerText;
        const textoModeracao = document.getElementById('texto-moderacao').innerText;
        
        // Validar ID da reclamação
        if (!idReclamacao) {
            showErrorMessage('ID da Reclamação é obrigatório para salvar como modelo.');
            return;
        }
        
        console.log('🔍 Elementos encontrados:', {
            linhaRaciocinioElement: document.getElementById('linha-raciocinio') ? 'OK' : 'NÃO ENCONTRADO',
            textoModeracaoElement: document.getElementById('texto-moderacao') ? 'OK' : 'NÃO ENCONTRADO'
        });
        
        console.log('📝 Dados capturados:', {
            solicitacaoCliente: solicitacaoCliente ? 'OK' : 'VAZIO',
            respostaEmpresa: respostaEmpresa ? 'OK' : 'VAZIO',
            motivoModeracao: motivoModeracao ? 'OK' : 'VAZIO',
            consideracaoFinal: consideracaoFinal ? 'OK' : 'VAZIO',
            linhaRaciocinio: linhaRaciocinio ? 'OK' : 'VAZIO',
            textoModeracao: textoModeracao ? 'OK' : 'VAZIO'
        });
        
        if (!solicitacaoCliente || !respostaEmpresa || !motivoModeracao || !consideracaoFinal) {
            console.error('❌ Dados incompletos:', {
                solicitacaoCliente: solicitacaoCliente ? 'OK' : 'VAZIO',
                respostaEmpresa: respostaEmpresa ? 'OK' : 'VAZIO',
                motivoModeracao: motivoModeracao ? 'OK' : 'VAZIO',
                consideracaoFinal: consideracaoFinal ? 'OK' : 'VAZIO'
            });
            showErrorMessage('Dados incompletos para salvar como modelo.');
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
                textoModeracao: textoModeracao
            })
        });
        
        console.log('📡 Resposta do servidor:', response.status, response.statusText);
        
        const data = await response.json();
        
        if (data.success) {
            showSuccessMessage('✅ Moderação salva como modelo para futuras solicitações!');
            console.log('📝 Modelo de moderação salvo:', data.modelo);
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
        const consideracaoFinal = document.getElementById('consideracao-final').value;
        
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
        const consideracaoFinal = document.getElementById('consideracao-final').value;
        
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

// ===== SISTEMA DE HISTÓRICO =====

// Carregar histórico do localStorage
function carregarHistorico() {
    try {
        const historicoSalvo = localStorage.getItem(HISTORICO_KEY);
        if (historicoSalvo) {
            historicoStats = JSON.parse(historicoSalvo);
        }
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
        historicoStats = [];
    }
}

// Salvar histórico no localStorage
function salvarHistorico() {
    try {
        localStorage.setItem(HISTORICO_KEY, JSON.stringify(historicoStats));
    } catch (error) {
        console.error('Erro ao salvar histórico:', error);
    }
}

// Adicionar entrada ao histórico
function adicionarAoHistorico(tipo, quantidade = 1) {
    const hoje = new Date();
    const dataHoje = hoje.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Verificar se já existe entrada para hoje
    let entradaHoje = historicoStats.find(entrada => entrada.data === dataHoje);
    
    if (entradaHoje) {
        // Atualizar entrada existente
        entradaHoje[tipo] = (entradaHoje[tipo] || 0) + quantidade;
        entradaHoje.ultimaAtualizacao = hoje.toISOString();
    } else {
        // Criar nova entrada
        entradaHoje = {
            data: dataHoje,
            respostas: tipo === 'respostas' ? quantidade : 0,
            moderacoes: tipo === 'moderacoes' ? quantidade : 0,
            ultimaAtualizacao: hoje.toISOString()
        };
        historicoStats.unshift(entradaHoje);
    }
    
    // Manter apenas os últimos 30 dias
    if (historicoStats.length > 30) {
        historicoStats = historicoStats.slice(0, 30);
    }
    
    salvarHistorico();
}

// Exibir histórico
// Funções removidas - funcionalidade obsoleta (histórico removido)
// function exibirHistorico() { ... }
// async function carregarHistoricoDoServidor() { ... }
// function exibirHistoricoServidor(historicoServidor) { ... }
// function toggleHistorico() { ... }

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
            // Não mostrar erro se Google Sheets não estiver configurado
            if (data.error === 'Google Sheets não está ativo') {
                console.log('📊 Google Sheets não configurado - continuando sem sincronização');
            } else {
                console.error('❌ Erro ao sincronizar estatísticas:', data.error);
                showErrorMessage('Erro ao sincronizar estatísticas: ' + data.error);
            }
        }
    } catch (error) {
        // Não mostrar erro se Google Sheets não estiver configurado
        if (error.message && error.message.includes('400')) {
            console.log('📊 Google Sheets não configurado - continuando sem sincronização');
        } else {
            console.error('❌ Erro ao sincronizar estatísticas:', error);
            showErrorMessage('Erro ao sincronizar estatísticas com a planilha');
        }
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
async function buscarSolicitacoes() {
    const dataInicio = document.getElementById('filtroDataInicio').value;
    const dataFim = document.getElementById('filtroDataFim').value;
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
        // Construir URL com parâmetros
        const params = new URLSearchParams();
        if (dataInicio) params.append('dataInicio', dataInicio);
        if (dataFim) params.append('dataFim', dataFim);
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
                // Preencher tabela com estrutura expansível
                tabela.innerHTML = solicitacoes.map((solicitacao, index) => {
                    const solicitacaoId = `solicitacao-${solicitacao.tipo}-${solicitacao.id || index}`;
                    const tipoBadge = solicitacao.tipo === 'resposta' 
                        ? '<span class="badge bg-success">Resposta</span>'
                        : '<span class="badge bg-warning">Moderação</span>';
                    
                    const statusBadge = solicitacao.status === 'Aprovada'
                        ? '<span class="badge bg-success">Aprovada</span>'
                        : '<span class="badge bg-secondary">' + (solicitacao.status || 'N/A') + '</span>';
                    
                    let detalhesResumo = '';
                    if (solicitacao.tipo === 'resposta') {
                        detalhesResumo = `
                            <strong>Tipo:</strong> ${solicitacao.tipoSolicitacao || 'N/A'}<br>
                            <strong>ID da Reclamação:</strong> ${solicitacao.idReclamacao || solicitacao.id_reclamacao || 'N/A'}<br>
                            <small class="text-muted">${(solicitacao.textoCliente || '').substring(0, 100)}${solicitacao.textoCliente && solicitacao.textoCliente.length > 100 ? '...' : ''}</small>
                        `;
                    } else {
                        detalhesResumo = `
                            <strong>Motivo:</strong> ${solicitacao.motivoModeracao || 'N/A'}<br>
                            <small class="text-muted">${(solicitacao.solicitacaoCliente || '').substring(0, 100)}${solicitacao.solicitacaoCliente && solicitacao.solicitacaoCliente.length > 100 ? '...' : ''}</small>
                        `;
                    }
                    
                    // Criar conteúdo de detalhes expandidos
                    let detalhesExpandidos = '';
                    if (solicitacao.tipo === 'resposta') {
                        detalhesExpandidos = `
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
                            ${solicitacao.observacoesInternas ? `
                            <div class="campo-detalhe">
                                <div class="campo-label">Observações Internas:</div>
                                <div class="campo-valor">${solicitacao.observacoesInternas}</div>
                            </div>
                            ` : ''}
                        `;
                    } else {
                        detalhesExpandidos = `
                            <div class="campo-detalhe" style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin-bottom: 15px;">
                                <div class="campo-label" style="font-size: 1.1rem; color: #856404;">
                                    <i class="fas fa-file-alt me-2"></i>Texto de Moderação (Essencial):
                                </div>
                                <div class="campo-valor" style="margin-top: 10px; font-weight: 500;">
                                    ${solicitacao.textoModeracao || 'N/A'}
                                </div>
                            </div>
                            <div class="campo-detalhe" style="background-color: #d1ecf1; padding: 15px; border-left: 4px solid #0dcaf0; margin-bottom: 15px;">
                                <div class="campo-label" style="font-size: 1.1rem; color: #055160;">
                                    <i class="fas fa-building me-2"></i>Resposta da Empresa (Essencial):
                                </div>
                                <div class="campo-valor" style="margin-top: 10px; font-weight: 500;">
                                    ${solicitacao.respostaEmpresa || 'N/A'}
                                </div>
                            </div>
                            <div class="campo-detalhe">
                                <div class="campo-label">Motivo da Moderação:</div>
                                <div class="campo-valor">${solicitacao.motivoModeracao || 'N/A'}</div>
                            </div>
                            <div class="campo-detalhe">
                                <div class="campo-label">Solicitação do Cliente:</div>
                                <div class="campo-valor">${solicitacao.solicitacaoCliente || 'N/A'}</div>
                            </div>
                            ${solicitacao.consideracaoFinal ? `
                            <div class="campo-detalhe">
                                <div class="campo-label">Consideração Final:</div>
                                <div class="campo-valor">${solicitacao.consideracaoFinal}</div>
                            </div>
                            ` : ''}
                            ${solicitacao.linhaRaciocinio ? `
                            <div class="campo-detalhe">
                                <div class="campo-label">Linha de Raciocínio:</div>
                                <div class="campo-valor">${solicitacao.linhaRaciocinio}</div>
                            </div>
                            ` : ''}
                            <div class="campo-detalhe" style="background-color: #f8f9fa; padding: 20px; border-left: 4px solid #0d6efd; margin-top: 20px;">
                                <div class="campo-label" style="font-size: 1.1rem; color: #0d6efd; margin-bottom: 15px;">
                                    <i class="fas fa-clipboard-check me-2"></i>Resultado da Moderação:
                                </div>
                                ${solicitacao.resultadoModeracao && (solicitacao.resultadoModeracao === 'Aceita' || solicitacao.resultadoModeracao === 'Negada') ? `
                                    <div class="alert ${solicitacao.resultadoModeracao === 'Aceita' ? 'alert-success' : 'alert-danger'}" style="margin-bottom: 15px;">
                                        <div class="d-flex justify-content-between align-items-center">
                                            <div>
                                                <strong>Status:</strong> ${solicitacao.resultadoModeracao === 'Aceita' ? '✅ Moderação Aceita' : '❌ Moderação Negada'}
                                            </div>
                                            ${solicitacao.resultadoModeracao === 'Negada' ? `
                                                <button class="btn btn-sm btn-light" onclick="verAnaliseCompletaNegada('${String(solicitacao.id || '').replace(/'/g, "\\'")}')" title="Ver análise completa FASE 2">
                                                    <i class="fas fa-search me-1"></i>
                                                    Ver Análise Completa (FASE 2)
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
                                </div>
                            </div>
                        `;
                    }
                    
                    return `
                        <tr>
                            <td>
                                <button class="btn-expandir" onclick="toggleDetalhesSolicitacao('${solicitacaoId}')" title="Expandir/Colapsar detalhes">
                                    <i class="fas fa-chevron-down" id="icon-${solicitacaoId}"></i>
                                </button>
                            </td>
                            <td>${solicitacao.data || 'N/A'}</td>
                            <td>${tipoBadge}</td>
                            <td><small>${solicitacao.id || 'N/A'}</small></td>
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
                }).join('');
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
    
    // Confirmar ação
    const confirmacao = confirm(`Deseja registrar que esta moderação foi ${resultado === 'Aceita' ? 'ACEITA' : 'NEGADA'} no Reclame Aqui?`);
    if (!confirmacao) {
        return;
    }
    
    // Mostrar loading
    const btnAceita = event.target.closest('.d-flex').querySelector('.btn-success');
    const btnNegada = event.target.closest('.d-flex').querySelector('.btn-danger');
    const btnOriginalText = event.target.innerHTML;
    event.target.disabled = true;
    event.target.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Salvando...';
    
    try {
        console.log('📤 Enviando requisição para registrar resultado:', {
            moderacaoId: moderacaoId,
            resultado: resultado,
            tipoId: typeof moderacaoId
        });
        
        const response = await fetch('/api/registrar-resultado-moderacao', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                moderacaoId: moderacaoId,
                resultado: resultado
            })
        });
        
        const data = await response.json();
        
        console.log('📥 Resposta do servidor:', data);
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao registrar resultado da moderação');
        }
        
        // Atualizar a interface - recarregar as solicitações
        const filtroDataInicio = document.getElementById('filtroDataInicio').value;
        const filtroDataFim = document.getElementById('filtroDataFim').value;
        const filtroTipo = document.getElementById('filtroTipo').value;
        
        // Recarregar as solicitações para atualizar o resultado
        await buscarSolicitacoes();
        
        // Re-expandir a linha que foi atualizada
        setTimeout(() => {
            const detalhesRow = document.getElementById(solicitacaoId);
            if (detalhesRow && !detalhesRow.classList.contains('show')) {
                toggleDetalhesSolicitacao(solicitacaoId);
            }
        }, 500);
        
        showSuccessMessage(`Resultado da moderação registrado com sucesso: ${resultado === 'Aceita' ? 'Moderação Aceita' : 'Moderação Negada'}`);
        
    } catch (error) {
        console.error('Erro ao registrar resultado da moderação:', error);
        showErrorMessage(error.message || 'Erro ao registrar resultado da moderação. Tente novamente.');
        event.target.disabled = false;
        event.target.innerHTML = btnOriginalText;
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
        
        const response = await fetch(`/api/moderacao/${encodeURIComponent(moderacaoId)}`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Erro ao carregar análise completa');
        }
        
        const mod = data.moderacao;
        const tipo = data.tipo;
        const aprendizado = data.aprendizadoAplicado;
        
        let html = `
            <div class="mb-4">
                <h5 class="text-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Moderação Negada - Análise Completa (FASE 2)
                </h5>
            </div>
            
            <div class="card mb-3">
                <div class="card-header bg-light">
                    <h6 class="mb-0"><i class="fas fa-info-circle me-2"></i>Dados Gerais</h6>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-6">
                            <p><strong>ID da Moderação:</strong> ${mod.idModeracao || 'N/A'}</p>
                            <p><strong>ID da Reclamação:</strong> ${mod.idReclamacao || 'N/A'}</p>
                            <p><strong>Tema:</strong> ${mod.tema || 'N/A'}</p>
                        </div>
                        <div class="col-md-6">
                            <p><strong>Motivo:</strong> ${mod.motivo || 'N/A'}</p>
                            <p><strong>Resultado:</strong> <span class="badge bg-danger">${mod.resultado || 'Negada'}</span></p>
                            <p><strong>Data do Registro:</strong> ${mod.dataRegistro || 'N/A'}</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card mb-3">
                <div class="card-header bg-light">
                    <h6 class="mb-0"><i class="fas fa-file-alt me-2"></i>Texto da Moderação Enviada</h6>
                </div>
                <div class="card-body">
                    <pre style="white-space: pre-wrap; word-wrap: break-word; background: #f8f9fa; padding: 15px; border-radius: 5px;">${mod.textoModeracao || 'N/A'}</pre>
                </div>
            </div>
            
            <div class="card mb-3">
                <div class="card-header bg-light">
                    <h6 class="mb-0"><i class="fas fa-comments me-2"></i>Contexto</h6>
                </div>
                <div class="card-body">
                    <p><strong>Solicitação do Cliente:</strong></p>
                    <pre style="white-space: pre-wrap; word-wrap: break-word; background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 15px;">${mod.solicitacaoCliente || 'N/A'}</pre>
                    <p><strong>Resposta da Empresa:</strong></p>
                    <pre style="white-space: pre-wrap; word-wrap: break-word; background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 15px;">${mod.respostaEmpresa || 'N/A'}</pre>
                    <p><strong>Consideração Final:</strong></p>
                    <pre style="white-space: pre-wrap; word-wrap: break-word; background: #f8f9fa; padding: 15px; border-radius: 5px;">${mod.consideracaoFinal || 'N/A'}</pre>
                </div>
            </div>
            
            <div class="card mb-3">
                <div class="card-header bg-light">
                    <h6 class="mb-0"><i class="fas fa-brain me-2"></i>Linha de Raciocínio Interna</h6>
                </div>
                <div class="card-body">
                    <pre style="white-space: pre-wrap; word-wrap: break-word; background: #f8f9fa; padding: 15px; border-radius: 5px;">${mod.linhaRaciocinio || 'N/A'}</pre>
                </div>
            </div>
        `;
        
        // Análise FASE 2 (se negada)
        if (tipo === 'negada') {
            html += `
                <div class="card mb-3 border-danger">
                    <div class="card-header bg-danger text-white">
                        <h6 class="mb-0">
                            <i class="fas fa-times-circle me-2"></i>
                            🔴 BLOCO 1 – MOTIVO DA NEGATIVA (BASE MANUAL)
                        </h6>
                    </div>
                    <div class="card-body">
                        <p style="white-space: pre-wrap; word-wrap: break-word;">${mod.motivoNegativa || 'N/A'}</p>
                    </div>
                </div>
                
                <div class="card mb-3 border-warning">
                    <div class="card-header bg-warning text-dark">
                        <h6 class="mb-0">
                            <i class="fas fa-exclamation-triangle me-2"></i>
                            🟡 BLOCO 2 – ONDE A SOLICITAÇÃO ERROU
                        </h6>
                    </div>
                    <div class="card-body">
                        <p style="white-space: pre-wrap; word-wrap: break-word;">${mod.ondeErrou || 'N/A'}</p>
                    </div>
                </div>
                
                <div class="card mb-3 border-success">
                    <div class="card-header bg-success text-white">
                        <h6 class="mb-0">
                            <i class="fas fa-check-circle me-2"></i>
                            🟢 BLOCO 3 – COMO CORRIGIR EM PRÓXIMAS SOLICITAÇÕES
                        </h6>
                    </div>
                    <div class="card-body">
                        <p style="white-space: pre-wrap; word-wrap: break-word;">${mod.comoCorrigir || 'N/A'}</p>
                    </div>
                </div>
            `;
        }
        
        // Histórico de aprendizado aplicado
        if (aprendizado) {
            html += `
                <div class="card mb-3 border-info">
                    <div class="card-header bg-info text-white">
                        <h6 class="mb-0">
                            <i class="fas fa-book me-2"></i>
                            📚 Histórico de Aprendizado Aplicado
                        </h6>
                    </div>
                    <div class="card-body">
                        <p>Esta moderação foi baseada em:</p>
                        <ul>
                            <li>${tipo === 'aceita' ? '✅ Moderações aceitas (FASE 3)' : '📖 Moderações coerentes'}</li>
                            ${tipo === 'negada' ? '<li>🔴 Ajustes por aprendizado negativo (FASE 2)</li>' : ''}
                        </ul>
                        ${aprendizado.mensagem ? `<p class="mt-2"><em>${aprendizado.mensagem}</em></p>` : ''}
                        ${aprendizado.pesoModelo ? `<p class="mt-2"><strong>Peso do modelo:</strong> ${aprendizado.pesoModelo.toFixed(2)}</p>` : ''}
                        ${aprendizado.quantidadeAceites ? `<p><strong>Quantidade de aceites que reforçaram este modelo:</strong> ${aprendizado.quantidadeAceites}</p>` : ''}
                    </div>
                </div>
            `;
        }
        
        modalBody.innerHTML = html;
        
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
        
        // Re-expandir a linha
        setTimeout(() => {
            const detalhesRow = document.getElementById(solicitacaoId);
            if (detalhesRow && !detalhesRow.classList.contains('show')) {
                toggleDetalhesSolicitacao(solicitacaoId);
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
    gerarFAQ,
    salvarRascunho,
    carregarRascunho,
    copiarResposta,
    verHistorico,
    fecharHistorico,
    // toggleHistorico, // Removido - funcionalidade obsoleta
    // visualizarModelosSalvos, // Removido - funcionalidade obsoleta
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
    
    // Mostrar modal para solicitar motivo da negativa
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
                            <label for="motivo-negativa" class="form-label">
                                <strong>Motivo da Negativa pelo Reclame Aqui:</strong>
                            </label>
                            <textarea 
                                class="form-control" 
                                id="motivo-negativa" 
                                rows="4" 
                                placeholder="Ex: Resposta não condizente com os fatos, tom inadequado, sem relação com a solicitação, etc."
                                required
                            ></textarea>
                            <div class="form-text">
                                Descreva o motivo específico pelo qual o RA negou a moderação para que possamos reformular adequadamente.
                            </div>
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
    
    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('negativaModal'));
    modal.show();
}

// Função para processar reformulação após negativa
async function processarReformulacaoAposNegativa() {
    const motivoNegativa = document.getElementById('motivo-negativa').value.trim();
    
    if (!motivoNegativa) {
        showErrorMessage('Por favor, informe o motivo da negativa pelo RA.');
        return;
    }
    
    // Fechar modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('negativaModal'));
    modal.hide();
    
    // Mostrar loading
    showLoadingMessage('Reformulando solicitação de moderação com base no motivo da negativa...');
    
    try {
        // Obter dados da moderação atual
        const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
        const respostaEmpresa = document.getElementById('resposta-empresa').value;
        const motivoModeracao = document.getElementById('motivo-moderacao').value;
        const consideracaoFinal = document.getElementById('consideracao-final').value;
        const textoNegado = document.getElementById('texto-moderacao').innerText;
        
        // Chamar o endpoint do servidor para reformulação
        const response = await fetch('/api/reformulate-moderation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                textoNegado: textoNegado,
                motivoNegativa: motivoNegativa,
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
            // Atualizar o texto de moderação com a versão reformulada
            const textoModeracao = document.getElementById('texto-moderacao');
            textoModeracao.innerHTML = data.result;
            
            // Atualizar linha de raciocínio para indicar reformulação
            const linhaRaciocinio = document.getElementById('linha-raciocinio');
            linhaRaciocinio.innerHTML = gerarLinhaRaciocinioModeracaoReformulada(
                motivoModeracao, 
                solicitacaoCliente, 
                respostaEmpresa, 
                motivoNegativa
            );
            
            // Mostrar seção de feedback
            const feedbackSection = document.getElementById('feedback-moderacao');
            feedbackSection.style.display = 'block';
            
            // Atualizar conteúdo do feedback
            const feedbackContent = feedbackSection.querySelector('.response-box');
            if (feedbackContent) {
                feedbackContent.innerHTML = `
                    <div class="alert alert-warning border-start border-warning border-4">
                        <h6 class="alert-heading">
                            <i class="fas fa-exclamation-triangle me-2"></i>
                            Reformulação Realizada
                        </h6>
                        <p class="mb-2"><strong>Motivo da Negativa:</strong> ${motivoNegativa}</p>
                        <p class="mb-0">A solicitação foi reformulada com base no feedback do Reclame Aqui para melhor adequação às regras de moderação.</p>
                    </div>
                `;
            }
            
            showSuccessMessage('Solicitação de moderação reformulada com sucesso!');
            
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

// Log de inicialização
console.log('🚀 Velotax Bot - Funções exportadas para uso global');
console.log('📋 Configurações disponíveis:', window.velotaxConfig);
console.log('🔧 Para alterar configurações, use: window.velotaxBot.alterarConfiguracaoEmpresa()');