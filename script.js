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

// Carregar estatísticas globais do servidor
async function carregarEstatisticasGlobais() {
    try {
        console.log('📊 Carregando estatísticas globais do servidor...');
        const response = await fetch('/api/estatisticas-globais');
        const data = await response.json();
        
        if (data.success) {
            estatisticasGlobais = data.estatisticas;
            console.log('✅ Estatísticas globais carregadas:', estatisticasGlobais);
            atualizarEstatisticasNaInterface();
        } else {
            console.error('❌ Erro ao carregar estatísticas globais:', data.error);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar estatísticas globais:', error);
    }
}

// Atualizar estatísticas na interface
function atualizarEstatisticasNaInterface() {
    console.log('🔄 Atualizando interface com estatísticas globais:', estatisticasGlobais);
    
    // Atualizar contadores na interface com dados globais do servidor
    const statItems = document.querySelectorAll('.stat-item');
    
    if (statItems.length >= 2) {
        // Primeiro item: Respostas Hoje
        const respostasValue = statItems[0].querySelector('.stat-value');
        if (respostasValue) {
            respostasValue.textContent = estatisticasGlobais.respostas_geradas || 0;
            console.log('📝 Respostas atualizadas:', estatisticasGlobais.respostas_geradas);
        }
        
        // Segundo item: Moderações
        const moderacoesValue = statItems[1].querySelector('.stat-value');
        if (moderacoesValue) {
            moderacoesValue.textContent = estatisticasGlobais.moderacoes_geradas || 0;
            console.log('⚖️ Moderações atualizadas:', estatisticasGlobais.moderacoes_geradas);
        }
    } else {
        console.log('⚠️ Elementos de estatísticas não encontrados');
    }
    
    // Atualizar histórico se estiver visível
    const historicoPanel = document.getElementById('historico-panel');
    if (historicoPanel && historicoPanel.style.display !== 'none') {
        exibirHistorico();
    }
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
    const motivoSolicitacao = document.getElementById('motivo-solicitacao');
    const reclamacao = document.getElementById('reclamacao-text');
    const solucao = document.getElementById('solucao-implementada');
    const historico = document.getElementById('historico-atendimento');
    const observacoes = document.getElementById('observacoes-internas');
    
    console.log('🔍 Elementos encontrados:', {
        tipoSituacao: tipoSituacao ? 'OK' : 'NÃO ENCONTRADO',
        motivoSolicitacao: motivoSolicitacao ? 'OK' : 'NÃO ENCONTRADO',
        reclamacao: reclamacao ? 'OK' : 'NÃO ENCONTRADO',
        solucao: solucao ? 'OK' : 'NÃO ENCONTRADO',
        historico: historico ? 'OK' : 'NÃO ENCONTRADO',
        observacoes: observacoes ? 'OK' : 'NÃO ENCONTRADO'
    });
    
    if (!tipoSituacao || !motivoSolicitacao || !reclamacao || !solucao) {
        console.error('❌ Elementos obrigatórios não encontrados!');
        showErrorMessage('Erro: Elementos do formulário não encontrados. Verifique se a página carregou corretamente.');
        return;
    }
    
    const tipoSituacaoValue = tipoSituacao.value;
    const motivoSolicitacaoValue = motivoSolicitacao.value;
    const reclamacaoValue = reclamacao.value;
    const solucaoValue = solucao.value;
    const historicoValue = historico.value;
    const observacoesValue = observacoes.value;
    
    console.log('Dados coletados:', {
        tipoSituacao: tipoSituacaoValue,
        motivoSolicitacao: motivoSolicitacaoValue,
        reclamacao: reclamacaoValue.substring(0, 50) + '...',
        solucao: solucaoValue.substring(0, 50) + '...'
    });
    
    // Validação dos campos obrigatórios
    if (!tipoSituacaoValue || !motivoSolicitacaoValue || !reclamacaoValue || (typeof reclamacaoValue === 'string' && !reclamacaoValue.trim()) || !solucaoValue || (typeof solucaoValue === 'string' && !solucaoValue.trim())) {
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
            motivo_solicitacao: motivoSolicitacaoValue,
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
        showErrorMessage('Erro ao gerar resposta. Tente novamente.');
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
            console.error('❌ Erro do servidor:', data.error);
            throw new Error(data.error || 'Erro desconhecido do servidor');
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
- Motivo da solicitação: ${dados.motivo_solicitacao}
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
    
    // Fechamento baseado no motivo
    switch (dados.motivo_solicitacao) {
        case 'pedido-desculpas':
            resposta += 'Pedimos desculpas pelo transtorno causado e agradecemos sua compreensão.\n\n';
            break;
        case 'confirmacao-solucao':
            resposta += 'Consideramos este assunto encerrado e agradecemos sua compreensão.\n\n';
            break;
        default:
            resposta += 'Seguimos à disposição para ajudar.\n\n';
    }
    
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
        motivo_solicitacao: document.getElementById('motivo-solicitacao').value,
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
            motivo_solicitacao: dadosAtuais.motivo_solicitacao,
            dadosFormulario: dadosAtuais,
            respostaAprovada: respostaAprovada,
            contexto: {
                tipoSituacao: dadosAtuais.tipo_solicitacao,
                motivoSolicitacao: dadosAtuais.motivo_solicitacao
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

// Função para visualizar modelos salvos no localStorage
function visualizarModelosSalvos() {
    const modelos = JSON.parse(localStorage.getItem('modelos_respostas_coerentes') || '[]');
    
    if (modelos.length === 0) {
        showErrorMessage('Nenhum modelo salvo encontrado no localStorage.');
        return;
    }
    
    let html = `
        <div class="modal fade" id="modalModelosSalvos" tabindex="-1">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-database me-2"></i>
                            Modelos de Respostas Coerentes Salvos
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info">
                            <i class="fas fa-info-circle me-2"></i>
                            <strong>Total de modelos salvos:</strong> ${modelos.length}
                        </div>
                        <div class="row">
    `;
    
    modelos.forEach((modelo, index) => {
        const dataFormatada = new Date(modelo.timestamp).toLocaleString('pt-BR');
        html += `
            <div class="col-md-6 mb-3">
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0">
                            <i class="fas fa-file-alt me-2"></i>
                            Modelo #${index + 1}
                        </h6>
                        <small class="text-muted">ID: ${modelo.id}</small>
                    </div>
                    <div class="card-body">
                        <p><strong>Tipo:</strong> ${modelo.tipo_situacao}</p>
                        <p><strong>Motivo:</strong> ${modelo.motivo_solicitacao}</p>
                        <p><strong>Data:</strong> ${dataFormatada}</p>
                        <p><strong>Resposta:</strong></p>
                        <div class="bg-light p-2 rounded" style="max-height: 200px; overflow-y: auto;">
                            ${modelo.respostaAprovada.substring(0, 200)}${modelo.respostaAprovada.length > 200 ? '...' : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += `
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
                        <button type="button" class="btn btn-danger" onclick="limparModelosSalvos()">
                            <i class="fas fa-trash me-2"></i>
                            Limpar Todos os Modelos
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remover modal existente se houver
    const modalExistente = document.getElementById('modalModelosSalvos');
    if (modalExistente) {
        modalExistente.remove();
    }
    
    // Adicionar modal ao DOM
    document.body.insertAdjacentHTML('beforeend', html);
    
    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalModelosSalvos'));
    modal.show();
}

// Função para limpar modelos salvos
function limparModelosSalvos() {
    if (confirm('Tem certeza que deseja limpar todos os modelos salvos? Esta ação não pode ser desfeita.')) {
        localStorage.removeItem('modelos_respostas_coerentes');
        showSuccessMessage('✅ Todos os modelos salvos foram removidos.');
        
        // Fechar modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalModelosSalvos'));
        if (modal) {
            modal.hide();
        }
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
- Motivo da solicitação: ${dados.motivo_solicitacao}
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
        document.getElementById('motivo-solicitacao').value = item.dados.motivo_solicitacao;
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
        motivo_solicitacao: document.getElementById('motivo-solicitacao').value,
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
    document.getElementById('motivo-solicitacao').value = rascunho.motivo_solicitacao;
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
        motivoSolicitacao: "esclarecimento",
        reclamacaoCliente: `Cliente solicita exclusão de seu cadastro da ${NOME_EMPRESA}. Ele não quer mais receber comunicações e deseja que todos os seus dados sejam removidos dos sistemas.`,
        solucaoImplementada: "Cadastro excluído no sistema em 12/08/2025 conforme solicitação.",
        historicoAtendimento: "Cliente já havia solicitado exclusão via WhatsApp em 15/01/2025, mas não recebeu confirmação.",
        observacoesInternas: "Cliente demonstrou satisfação com o atendimento."
    },
    {
        nome: "Exclusão de Cadastro - Negada",
        tipoSituacao: "exclusao-cadastro",
        motivoSolicitacao: "esclarecimento",
        reclamacaoCliente: `Cliente solicita exclusão de seu cadastro da ${NOME_EMPRESA}. Ele não quer mais receber comunicações e deseja que todos os seus dados sejam removidos dos sistemas.`,
        solucaoImplementada: "Não foi possível realizar a exclusão do cadastro devido a pendências contratuais ativas.",
        historicoAtendimento: "Cliente possui operação em andamento que impede a exclusão.",
        observacoesInternas: "Explicar ao cliente sobre as pendências e como resolver."
    },
    {
        nome: "Liberação de Chave Pix - Realizada",
        tipoSituacao: "exclusao-chave-pix-cpf",
        motivoSolicitacao: "esclarecimento",
        reclamacaoCliente: "Cliente solicita liberação da chave Pix CPF para portabilidade. Ele quer transferir para outro banco.",
        solucaoImplementada: "Portabilidade da chave Pix concluída e confirmada em contato com o cliente.",
        historicoAtendimento: "Cliente já havia tentado fazer a portabilidade anteriormente.",
        observacoesInternas: "Processo realizado em 2 dias úteis conforme previsto."
    },
    {
        nome: "Liberação de Chave Pix - Negada",
        tipoSituacao: "exclusao-chave-pix-cpf",
        motivoSolicitacao: "esclarecimento",
        reclamacaoCliente: "Cliente solicita liberação da chave Pix CPF para portabilidade. Ele quer transferir para outro banco.",
        solucaoImplementada: "Não foi possível realizar a liberação da chave Pix devido a operação ativa.",
        historicoAtendimento: "Cliente possui antecipação em andamento que impede a liberação.",
        observacoesInternas: "Aguardar finalização da operação para liberar a chave."
    },
    {
        nome: "Quitação - Realizada",
        tipoSituacao: "quitacao",
        motivoSolicitacao: "esclarecimento",
        reclamacaoCliente: "Cliente questiona sobre quitação de antecipação. Ele acredita que já quitou mas ainda aparece débito.",
        solucaoImplementada: "Antecipação quitada automaticamente em 31/07/2025 quando restituição foi depositada pela Receita Federal.",
        historicoAtendimento: "Cliente recebeu restituição do IR em 31/07/2025.",
        observacoesInternas: "Sistema atualizado automaticamente após depósito da restituição."
    },
    {
        nome: "SERASA/SPC - Inclusão",
        tipoSituacao: "juros-abusivos",
        motivoSolicitacao: "esclarecimento",
        reclamacaoCliente: "Cliente questiona inclusão em SERASA/SPC. Ele não entende por que foi incluído.",
        solucaoImplementada: "Antecipação não foi quitada na data prevista, resultando em inclusão nos órgãos de proteção ao crédito.",
        historicoAtendimento: "Cliente não quitou a antecipação no prazo estabelecido.",
        observacoesInternas: "Explicar sobre descumprimento contratual e como regularizar."
    },
    {
        nome: "Análise em Andamento",
        tipoSituacao: "exclusao-cadastro",
        motivoSolicitacao: "esclarecimento",
        reclamacaoCliente: `Cliente solicita exclusão de seu cadastro da ${NOME_EMPRESA}. Ele não quer mais receber comunicações.`,
        solucaoImplementada: "Solicitação em análise pela equipe técnica. Aguardando verificação de pendências.",
        historicoAtendimento: "Cliente fez a solicitação há 2 dias úteis.",
        observacoesInternas: "Análise deve ser concluída em até 5 dias úteis."
    },
    {
        nome: "Juros Abusivos - Análise",
        tipoSituacao: "juros-abusivos",
        motivoSolicitacao: "reclamação",
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
            'motivo-solicitacao': document.getElementById('motivo-solicitacao'),
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
        elementos['motivo-solicitacao'].value = exemplo.motivoSolicitacao;
        elementos['reclamacao-text'].value = exemplo.reclamacaoCliente;
        elementos['solucao-implementada'].value = exemplo.solucaoImplementada;
        elementos['historico-atendimento'].value = exemplo.historicoAtendimento;
        elementos['observacoes-internas'].value = exemplo.observacoesInternas;
        
        // Verificar se os valores foram definidos
        console.log('Valores definidos:');
        console.log('- tipo-situacao:', elementos['tipo-situacao'].value);
        console.log('- motivo-solicitacao:', elementos['motivo-solicitacao'].value);
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
    const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
    const respostaEmpresa = document.getElementById('resposta-empresa').value;
    const motivoModeracao = document.getElementById('motivo-moderacao').value;
    const consideracaoFinal = document.getElementById('consideracao-final').value;
    
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

function gerarExplicacao() {
    const tema = document.getElementById('tema-explicacao').value;
    
    if (!tema) {
        showErrorMessage('Por favor, selecione o tema a explicar.');
        return;
    }
    
    const explicacao = gerarMensagemExplicativa(tema, '');
    
    document.getElementById('explicacao-content').innerHTML = explicacao;
    document.getElementById('explicacao-resultado').style.display = 'block';
    
    showSuccessMessage('Explicação gerada com sucesso!');
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
            <p><strong>📌 Empréstimo do Trabalhador – Resumo</strong></p>
            
            <p><strong>O que é:</strong><br>
            Linha de crédito consignado, com parcelas descontadas direto do salário ou benefício.</p>
            
            <p><strong>Vantagens:</strong></p>
            <ul>
                <li>Sem boletos ou lembretes de pagamento.</li>
                <li>Valor liberado via Pix (CPF).</li>
            </ul>
            
            <p><strong>Durante o contrato:</strong></p>
            <ul>
                <li>Desconto em folha (holerite/contracheque).</li>
                <li>Em caso de demissão, o desconto para, mas o saldo devedor deve ser pago por boleto/Pix.</li>
                <li>Verbas rescisórias podem ser usadas para abater a dívida.</li>
            </ul>
            
            <p><strong>Critérios de elegibilidade:</strong></p>
            
            <p><strong>👤 Colaborador</strong></p>
            <ul>
                <li>Idade: 18 a 62 anos (homens) / 18 a 65 anos (mulheres).</li>
                <li>CLT há pelo menos 12 meses.</li>
                <li>Empregado(a) doméstico(a).</li>
                <li>Diretor(a) com recolhimento de FGTS.</li>
            </ul>
            
            <p><strong>🏢 Empresa</strong></p>
            <ul>
                <li>CNPJ ativo há pelo menos 36 meses.</li>
            </ul>
            
            <p><strong>🚫 Não pode solicitar:</strong></p>
            <ul>
                <li>Funcionários afastados pelo INSS.</li>
                <li>Em aviso prévio.</li>
                <li>Já desligados no sistema.</li>
            </ul>
            
            <p><strong>Etapas no App:</strong></p>
            <ol>
                <li><strong>Acesso:</strong> Tela inicial → Crédito do Trabalhador → Ver proposta.</li>
                <li><strong>Autorização:</strong> Aceitar o termo de consentimento.</li>
                <li><strong>Valor:</strong> Escolher o limite desejado.</li>
                <li><strong>Simulação:</strong> Conferir parcelas, juros e total.</li>
                <li><strong>Processamento:</strong> Sistema analisa os dados.</li>
                <li><strong>Selfie:</strong> Foto para validação facial.</li>
                <li><strong>Validação automática:</strong> Pode levar até 30 minutos.</li>
                <li><strong>Confirmação:</strong> Resumo final → Confirmar.</li>
            </ol>
            
            <p>Nossa equipe está disponível para orientações adicionais sobre o Crédito do Trabalhador.</p>
        `,
        'credito-pessoal': `
            <p><strong>Prezado(a) cliente,</strong></p>
            <p>Vamos esclarecer sobre o Crédito Pessoal:</p>
            <ol>
                <li><strong>O que é:</strong> É um empréstimo sem destinação específica para uso pessoal</li>
                <li><strong>Características:</strong> Valor fixo, prazo determinado e parcelas mensais</li>
                <li><strong>Finalidade:</strong> Pode ser usado para qualquer necessidade pessoal</li>
                <li><strong>Análise:</strong> Baseada na renda e histórico de crédito do cliente</li>
                <li><strong>Documentação:</strong> Comprovantes de renda e documentos pessoais</li>
            </ol>
            <p>Nossa equipe está disponível para orientações sobre crédito pessoal.</p>
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

async function revisarTexto() {
    const textoOriginal = document.getElementById('texto-revisar').value;
    const tipoRevisaoSelect = document.getElementById('tipo-revisao');
    const observacoes = document.getElementById('observacoes-revisao').value;
    
    if (!textoOriginal.trim()) {
        showErrorMessage('Por favor, insira o texto a ser revisado.');
        return;
    }
    
    // Obter tipos de revisão selecionados
    const tipoRevisao = Array.from(tipoRevisaoSelect.selectedOptions).map(option => option.value);
    
    if (tipoRevisao.length === 0) {
        showErrorMessage('Por favor, selecione pelo menos um tipo de revisão.');
        return;
    }
    
    // Mostrar loading
    showLoadingMessage('Revisando texto com IA...');
    
    try {
        // Chamar endpoint do servidor
        const response = await fetch('/api/revisar-texto', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                textoOriginal: textoOriginal,
                tipoRevisao: tipoRevisao,
                observacoes: observacoes
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Processar a resposta que vem com dois blocos
            const resultado = data.result;
            
            // Separar os dois blocos da resposta
            const blocos = separarBlocosRevisao(resultado);
            
            // Formatar e exibir a linha de raciocínio
            const linhaRaciocinio = formatarLinhaRaciocinioRevisao(blocos.linhaRaciocinio);
            
            // Formatar e exibir o texto revisado
            const textoRevisado = formatarTextoRevisado(blocos.textoRevisado);
            
            document.getElementById('linha-raciocinio-revisao').innerHTML = linhaRaciocinio;
            document.getElementById('texto-revisado').innerHTML = textoRevisado;
            document.getElementById('revisao-resultado').style.display = 'block';
            
            showSuccessMessage('Texto revisado com sucesso!');
        } else {
            showErrorMessage('Erro na revisão: ' + data.error);
        }
        
    } catch (error) {
        console.error('Erro ao revisar texto:', error);
        showErrorMessage('Erro ao revisar texto. Tente novamente.');
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

function gerarEmail() {
    const tipoEmail = document.getElementById('tipo-email').value;
    const assunto = document.getElementById('assunto-email').value;
    const destinatario = document.getElementById('destinatario').value;
    const contexto = document.getElementById('contexto-email').value;
    
    if (!tipoEmail || !assunto.trim()) {
        showErrorMessage('Por favor, selecione o tipo de e-mail e preencha o assunto.');
        return;
    }
    
    const email = gerarEmailFormal(tipoEmail, assunto, destinatario, contexto);
    
    document.getElementById('email-content').innerHTML = email;
    document.getElementById('email-resultado').style.display = 'block';
    
    showSuccessMessage('E-mail gerado com sucesso!');
}

function gerarEmailFormal(tipo, assunto, destinatario, contexto) {
    let email = '';
    
    // Saudação
    email += `<p><strong>Assunto:</strong> ${assunto}</p>`;
    email += `<p>Prezado(a) ${destinatario || 'cliente'},</p>`;
    
    // Corpo baseado no tipo
    switch (tipo) {
        case 'resposta-cliente':
            email += '<p>Agradecemos seu contato e lamentamos pelo transtorno causado.</p>';
            email += '<p>Informamos que sua solicitação está sendo analisada por nossa equipe especializada.</p>';
            break;
        case 'esclarecimento':
            email += '<p>Viemos por meio desta esclarecer sobre a situação mencionada.</p>';
            break;
        case 'solicitacao':
            email += '<p>Gostaríamos de solicitar algumas informações adicionais para melhor atendê-lo(a).</p>';
            break;
        case 'confirmacao':
            email += '<p>Confirmamos o recebimento de sua solicitação.</p>';
            break;
    }
    
    // Contexto específico
    if (contexto.trim()) {
        email += `<p>${contexto}</p>`;
    }
    
    // Fechamento
    email += '<p>Em caso de dúvidas, estamos à disposição.</p>';
    email += `<p>Atenciosamente,<br>Equipe ${NOME_EMPRESA}</p>`;
    
    return email;
}


// ===== FUNÇÕES DE FAQ & COMPLIANCE =====

function gerarFAQ() {
    const tema = document.getElementById('tema-faq').value;
    const pergunta = document.getElementById('pergunta-faq').value;
    
    if (!tema) {
        showErrorMessage('Por favor, selecione o tema.');
        return;
    }
    
    const respostaFAQ = gerarRespostaFAQ(tema, pergunta);
    
    document.getElementById('faq-content').innerHTML = respostaFAQ;
    document.getElementById('faq-resultado').style.display = 'block';
    
    showSuccessMessage('Resposta FAQ gerada com sucesso!');
}

function gerarRespostaFAQ(tema, pergunta) {
    const respostas = {
        'lgpd': `
            <p><strong>Pergunta:</strong> ${pergunta || 'Como a LGPD afeta meus dados?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>A Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018) garante seus direitos sobre seus dados pessoais:</p>
            <ul>
                <li>Acesso aos seus dados</li>
                <li>Correção de informações incorretas</li>
                <li>Exclusão de dados</li>
                <li>Portabilidade de dados</li>
            </ul>
            <p>Para exercer qualquer um desses direitos, entre em contato conosco.</p>
        `,
        'reclame-aqui': `
            <p><strong>Pergunta:</strong> ${pergunta || 'Como funciona o Reclame Aqui?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>O Reclame Aqui é uma plataforma que conecta consumidores e empresas para resolução de problemas:</p>
            <ul>
                <li>Registro de reclamações</li>
                <li>Resposta da empresa</li>
                <li>Avaliação do atendimento</li>
                <li>Medição de satisfação</li>
            </ul>
            <p>Nossa equipe está sempre pronta para atender suas solicitações.</p>
        `,
        'receita-federal': `
            <p><strong>Pergunta:</strong> ${pergunta || 'Como acessar o Portal da Receita Federal?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>Para acessar o Portal da Receita Federal:</p>
            <ol>
                <li>Acesse www.gov.br/receitafederal</li>
                <li>Clique em "eCAC"</li>
                <li>Faça login com CPF e senha</li>
                <li>Navegue pelas opções disponíveis</li>
            </ol>
            <p>Em caso de dúvidas, nossa equipe está disponível para orientações.</p>
        `,
        'compliance': `
            <p><strong>Pergunta:</strong> ${pergunta || 'Quais são as políticas de compliance da empresa?'}</p>
            <p><strong>Resposta:</strong></p>
            <p>Nossa empresa segue rigorosas políticas de compliance:</p>
            <ul>
                <li>Conformidade com a LGPD</li>
                <li>Respeito às regulamentações</li>
                <li>Transparência nas operações</li>
                <li>Proteção de dados</li>
            </ul>
            <p>Estamos comprometidos com a ética e transparência em todas as nossas atividades.</p>
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
        const solicitacaoCliente = document.getElementById('solicitacao-cliente').value;
        const respostaEmpresa = document.getElementById('resposta-empresa').value;
        const motivoModeracao = document.getElementById('motivo-moderacao').value;
        const consideracaoFinal = document.getElementById('consideracao-final').value;
        
        const linhaRaciocinio = document.getElementById('linha-raciocinio').innerText;
        const textoModeracao = document.getElementById('texto-moderacao').innerText;
        
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
function exibirHistorico() {
    const historicoContent = document.getElementById('historico-content');
    
    // Carregar histórico do servidor
    carregarHistoricoDoServidor();
}

// Carregar histórico do servidor
async function carregarHistoricoDoServidor() {
    try {
        console.log('📊 Carregando histórico do servidor...');
        const response = await fetch('/api/estatisticas-globais');
        const data = await response.json();
        
        if (data.success && data.historico) {
            exibirHistoricoServidor(data.historico);
        } else {
            document.getElementById('historico-content').innerHTML = `
                <div class="historico-empty">
                    <i class="fas fa-exclamation-triangle fa-2x mb-2"></i>
                    <p>Erro ao carregar histórico</p>
                    <small>Tente novamente em alguns instantes</small>
                </div>
            `;
        }
    } catch (error) {
        console.error('❌ Erro ao carregar histórico do servidor:', error);
        document.getElementById('historico-content').innerHTML = `
            <div class="historico-empty">
                <i class="fas fa-exclamation-triangle fa-2x mb-2"></i>
                <p>Erro ao carregar histórico</p>
                <small>Tente novamente em alguns instantes</small>
            </div>
        `;
    }
}

// Exibir histórico do servidor
function exibirHistoricoServidor(historicoServidor) {
    const historicoContent = document.getElementById('historico-content');
    
    if (!historicoServidor || historicoServidor.length === 0) {
        historicoContent.innerHTML = `
            <div class="historico-empty">
                <i class="fas fa-inbox fa-2x mb-2"></i>
                <p>Nenhum histórico disponível</p>
                <small>As estatísticas aparecerão aqui conforme o uso</small>
            </div>
        `;
        return;
    }
    
    let html = '';
    historicoServidor.forEach(entrada => {
        const data = new Date(entrada.data);
        const dataFormatada = data.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        
        const respostas = entrada.respostas_geradas || 0;
        const moderacoes = entrada.moderacoes_geradas || 0;
        const respostasCoerentes = entrada.respostas_coerentes || 0;
        const moderacoesCoerentes = entrada.moderacoes_coerentes || 0;
        const revisoes = entrada.revisoes_texto || 0;
        const explicacoes = entrada.explicacoes_geradas || 0;
        
        html += `
            <div class="historico-item">
                <div class="historico-data">
                    <i class="fas fa-calendar-day me-1"></i>
                    ${dataFormatada}
                </div>
                <div class="historico-stats">
                    <div class="historico-stat respostas">
                        <i class="fas fa-reply"></i>
                        <span>${respostas} respostas</span>
                    </div>
                    <div class="historico-stat moderacoes">
                        <i class="fas fa-gavel"></i>
                        <span>${moderacoes} moderações</span>
                    </div>
                    <div class="historico-stat coerentes">
                        <i class="fas fa-check-circle"></i>
                        <span>${respostasCoerentes + moderacoesCoerentes} coerentes</span>
                    </div>
                    <div class="historico-stat revisoes">
                        <i class="fas fa-edit"></i>
                        <span>${revisoes} revisões</span>
                    </div>
                    <div class="historico-stat explicacoes">
                        <i class="fas fa-book"></i>
                        <span>${explicacoes} explicações</span>
                    </div>
                </div>
            </div>
        `;
    });
    
    historicoContent.innerHTML = html;
}

// Toggle do painel de histórico
function toggleHistorico() {
    const panel = document.getElementById('historico-panel');
    const isVisible = panel.style.display !== 'none';
    
    if (isVisible) {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
        exibirHistorico();
    }
}

// Inicializar sistema de histórico
function inicializarHistorico() {
    // Carregar apenas estatísticas globais do servidor
    carregarEstatisticasGlobais();
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
    revisarTexto,
    gerarEmail,
    gerarFAQ,
    salvarRascunho,
    carregarRascunho,
    copiarResposta,
    verHistorico,
    fecharHistorico,
    toggleHistorico,
    visualizarModelosSalvos,
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

// Log de inicialização
console.log('🚀 Velotax Bot - Funções exportadas para uso global');
console.log('📋 Configurações disponíveis:', window.velotaxConfig);
console.log('🔧 Para alterar configurações, use: window.velotaxBot.alterarConfiguracaoEmpresa()');