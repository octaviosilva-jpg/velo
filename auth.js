// ================== SISTEMA DE AUTENTICAÇÃO GOOGLE SSO ==================
// Velotax Bot - Sistema de Validação de Acesso
// Implementação completa conforme especificação

// ================== CONFIGURAÇÕES ==================
let DOMINIO_PERMITIDO = "@velotax.com.br"; // Domínio corporativo
let CLIENT_ID = null; // Será carregado do servidor

// Verificar se estamos em modo de desenvolvimento ou produção
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const isVercel = window.location.hostname.includes('vercel.app');
const currentDomain = window.location.origin;

// ================== ELEMENTOS DO DOM ==================
const identificacaoOverlay = document.getElementById('identificacao-overlay');
const appWrapper = document.querySelector('.app-wrapper');
const errorMsg = document.getElementById('identificacao-error');

// ================== VARIÁVEIS DE ESTADO ==================
let dadosUsuario = null;
let tokenClient = null;

// ================== CARREGAR CONFIGURAÇÕES DO SERVIDOR ==================
async function carregarConfiguracoes() {
    try {
        console.log('🔧 Carregando configurações do servidor...');
        const response = await fetch('/api/google-config');
        if (response.ok) {
            const config = await response.json();
            CLIENT_ID = config.clientId;
            console.log('✅ Configurações carregadas:', { 
                CLIENT_ID: CLIENT_ID && CLIENT_ID !== 'SEU_CLIENT_ID_AQUI' ? 'Configurado' : 'Não configurado',
                Dominio: config.dominioPermitido || 'Não configurado',
                Debug: config.debug || 'N/A'
            });
            
            // Verificar se o CLIENT_ID está no formato correto
            if (CLIENT_ID && !CLIENT_ID.includes('.apps.googleusercontent.com')) {
                console.warn('⚠️ CLIENT_ID pode estar incompleto:', CLIENT_ID);
            }
        } else {
            console.log('⚠️ CLIENT_ID não configurado no servidor');
            CLIENT_ID = null; // Sem fallback hardcoded
        }
    } catch (error) {
        console.log('⚠️ Erro ao carregar configurações:', error);
        CLIENT_ID = null; // Sem fallback hardcoded
    }
}

// ================== FUNÇÕES DE CONTROLE DE UI ==================
function showOverlay() {
    console.log('🔐 Mostrando overlay de login');
    if (identificacaoOverlay) {
        identificacaoOverlay.classList.remove('hidden');
        identificacaoOverlay.style.display = 'flex';
        identificacaoOverlay.style.opacity = '1';
        identificacaoOverlay.style.visibility = 'visible';
        identificacaoOverlay.style.zIndex = '99999';
        console.log('✅ Overlay de login exibido');
    } else {
        console.error('❌ Elemento identificacao-overlay não encontrado!');
    }
    
    if (appWrapper) {
        appWrapper.classList.remove('authenticated');
        appWrapper.style.display = 'none';
        appWrapper.style.opacity = '0';
        appWrapper.style.visibility = 'hidden';
        console.log('✅ Interface principal ocultada');
    } else {
        console.error('❌ Elemento app-wrapper não encontrado!');
    }
}

function hideOverlay() {
    console.log('✅ Ocultando overlay de login');
    if (identificacaoOverlay) {
        identificacaoOverlay.classList.add('hidden');
        identificacaoOverlay.style.display = 'none';
        identificacaoOverlay.style.opacity = '0';
        identificacaoOverlay.style.visibility = 'hidden';
        identificacaoOverlay.style.zIndex = '-1';
        console.log('✅ Overlay de login ocultado');
    }
    
    if (appWrapper) {
        appWrapper.classList.add('authenticated');
        appWrapper.style.display = 'block';
        appWrapper.style.opacity = '1';
        appWrapper.style.visibility = 'visible';
        appWrapper.style.zIndex = '1';
        console.log('✅ Interface principal exibida');
    }
}

// ================== LÓGICA DE AUTENTICAÇÃO ==================
function waitForGoogleScript() {
    return new Promise((resolve, reject) => {
        console.log('🔍 Verificando script Google Identity Services...');
        
        const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
        if (!script) {
            console.error('❌ Script Google Identity Services não encontrado no HTML');
            return reject(new Error('Script Google Identity Services não encontrado no HTML.'));
        }
        
        console.log('✅ Script Google Identity Services encontrado');
        
        if (window.google && window.google.accounts) {
            console.log('✅ Google Identity Services já carregado');
            return resolve(window.google.accounts);
        }
        
        console.log('⏳ Aguardando carregamento do Google Identity Services...');
        
        script.onload = () => {
            console.log('📥 Script Google Identity Services carregado');
            if (window.google && window.google.accounts) {
                console.log('✅ Google Identity Services disponível');
                resolve(window.google.accounts);
            } else {
                console.error('❌ Google Identity Services não disponível após carregamento');
                reject(new Error('Google Identity Services não carregou corretamente.'));
            }
        };
        
        script.onerror = () => {
            console.error('❌ Erro ao carregar script Google Identity Services');
            reject(new Error('Erro ao carregar o script Google Identity Services.'));
        };
        
        // Timeout de 10 segundos
        setTimeout(() => {
            if (!window.google || !window.google.accounts) {
                console.error('❌ Timeout aguardando Google Identity Services');
                reject(new Error('Timeout aguardando carregamento do Google Identity Services.'));
            }
        }, 10000);
    });
}

async function handleGoogleSignIn(response) {
    try {
        console.log('🔐 Processando login do Google...');
            console.log('📋 Response recebido:', response);
            
            // Verificar se há erro na resposta
            if (response && response.error) {
                console.error('❌ Erro do Google OAuth:', response.error);
                console.error('❌ Detalhes do erro:', response);
                errorMsg.textContent = 'Erro na autenticação. Tente novamente.';
                errorMsg.classList.remove('hidden');
                return;
            }
            
            if (!response || !response.access_token) {
                console.error('❌ Token de acesso não recebido');
                errorMsg.textContent = 'Erro: Token de acesso não recebido do Google.';
                errorMsg.classList.remove('hidden');
                return;
            }
        
        // 1. Buscar dados do usuário na API do Google
        console.log('🌐 Buscando dados do usuário na API do Google...');
        const googleResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${response.access_token}` }
        });
        
        if (!googleResponse.ok) {
            console.error('❌ Erro na API do Google:', googleResponse.status);
            errorMsg.textContent = 'Erro ao buscar dados do usuário no Google.';
            errorMsg.classList.remove('hidden');
            return;
        }
        
        const user = await googleResponse.json();

        console.log('👤 Dados do usuário recebidos:', {
            nome: user.name,
            email: user.email,
            dominio: user.email ? user.email.split('@')[1] : 'N/A'
        });

        // 2. Validar domínio corporativo
        if (user.email && user.email.endsWith(DOMINIO_PERMITIDO)) {
            console.log('✅ Domínio corporativo validado');
            
            // 3. Buscar perfil adicional (opcional)
            let userProfile = {};
            try {
                const profileResponse = await fetch(`/api/getUserProfile?email=${encodeURIComponent(user.email)}`);
                if (profileResponse.ok) {
                    userProfile = await profileResponse.json();
                    console.log('📋 Perfil do usuário carregado:', userProfile);
                }
            } catch (error) {
                console.log('⚠️ Perfil adicional não disponível, usando padrão');
            }

            // 4. Salvar dados do usuário
            dadosUsuario = {
                nome: user.name,
                email: user.email,
                foto: user.picture,
                timestamp: Date.now(),
                funcao: userProfile.funcao || 'Usuário',
                departamento: userProfile.departamento || 'Geral',
                genero: userProfile.genero || undefined
            };

            // 5. Persistir no localStorage
            localStorage.setItem('dadosUsuario', JSON.stringify(dadosUsuario));
            console.log('💾 Dados do usuário salvos no localStorage');
            
            // 6. Log de acesso (opcional)
            await logUserAccess('online');
            
            // 7. Iniciar aplicação
            hideOverlay();
            iniciarAplicacao();
            
        } else {
            // Domínio não permitido
            console.log('❌ Domínio não permitido:', user.email);
            errorMsg.textContent = `Acesso permitido apenas para e-mails ${DOMINIO_PERMITIDO}!`;
            errorMsg.classList.remove('hidden');
        }
        
    } catch (error) {
        console.error("❌ Erro no fluxo de login:", error);
        errorMsg.textContent = 'Erro ao verificar login ou permissões. Tente novamente.';
        errorMsg.classList.remove('hidden');
    }
}

function verificarIdentificacao() {
    console.log('🔍 Verificando identificação...');
    console.log('🌐 isVercel:', isVercel);
    console.log('🌐 hostname:', window.location.hostname);
    
    // Autenticação obrigatória em todos os ambientes
    
    // SEMPRE mostrar overlay primeiro (forçar autenticação)
    console.log('🔐 Forçando exibição do overlay de login');
    showOverlay();
    
    // Limpar dados salvos para forçar nova autenticação
    console.log('🧹 Limpando dados salvos para forçar nova autenticação');
    localStorage.removeItem('dadosUsuario');
    dadosUsuario = null;
}

async function initGoogleSignIn() {
    try {
        console.log('🔧 Inicializando Google Sign-In...');
        
        // GARANTIR que a interface fique oculta por padrão
        console.log('🔐 Forçando overlay de login...');
        showOverlay();
        
        // Verificar se os elementos existem
        if (!identificacaoOverlay) {
            console.error('❌ Elemento identificacao-overlay não encontrado!');
            return;
        }
        if (!appWrapper) {
            console.error('❌ Elemento app-wrapper não encontrado!');
            return;
        }
        
        // Verificar se o Google Identity Services foi carregado
        if (!window.google || !window.google.accounts || !window.google.accounts.id) {
            console.warn('⚠️ Google Identity Services não foi carregado, aguardando...');
            
            // Aguardar até 10 segundos para o Google carregar
            let tentativas = 0;
            const maxTentativas = 10;
            
            while (tentativas < maxTentativas && (!window.google || !window.google.accounts || !window.google.accounts.id)) {
                console.log(`⏳ Aguardando Google Identity Services... (${tentativas + 1}/${maxTentativas})`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                tentativas++;
            }
            
            if (!window.google || !window.google.accounts || !window.google.accounts.id) {
                console.error('❌ Google Identity Services não foi carregado após 10 segundos');
                console.log('🔧 Tentando recarregar a página...');
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
                return;
            }
        }
        
        console.log('✅ Elementos DOM encontrados:', {
            overlay: !!identificacaoOverlay,
            wrapper: !!appWrapper
        });
        
        // 1. Carregar configurações do servidor primeiro
        await carregarConfiguracoes();
        
        console.log('📋 Configurações carregadas:', {
            clientId: CLIENT_ID ? CLIENT_ID.substring(0, 20) + '...' : 'Não configurado',
            dominio: DOMINIO_PERMITIDO
        });
        
        // 2. Verificar se CLIENT_ID é válido
        if (!CLIENT_ID || CLIENT_ID.length < 10 || CLIENT_ID === 'SEU_CLIENT_ID_AQUI') {
            console.log('⚠️ CLIENT_ID não configurado');
            errorMsg.textContent = 'Sistema de autenticação não configurado.';
            errorMsg.classList.remove('hidden');
            return;
        }
        
            // Para desenvolvimento, usar CLIENT_ID da Velotax com configuração especial
            if (isDevelopment) {
                console.log('🔧 Modo desenvolvimento detectado');
                console.log('🔧 CLIENT_ID atual:', CLIENT_ID);
                
                // Manter CLIENT_ID da Velotax mas com configuração especial para localhost
                console.log('🔧 Usando CLIENT_ID da Velotax com configuração especial para localhost');
            }
        
        // Verificar se o CLIENT_ID é válido para o domínio atual
        if (isDevelopment && CLIENT_ID && !CLIENT_ID.includes('.apps.googleusercontent.com')) {
            console.log('⚠️ CLIENT_ID pode não estar no formato correto para localhost');
            errorMsg.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Configuração necessária:</strong><br>
                O CLIENT_ID do Google OAuth precisa ser configurado para localhost.<br>
                <small>Configure o CLIENT_ID no arquivo .env ou use a opção de desenvolvimento abaixo.</small>
            `;
            errorMsg.classList.remove('hidden');
        }
        
        // 2. Aguardar script do Google
        const accounts = await waitForGoogleScript();
        
        // 3. Configurar cliente OAuth
        tokenClient = accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: 'profile email',
            callback: handleGoogleSignIn
        });
        
        // 4. Configurar botão de login
        document.getElementById('google-signin-button').addEventListener('click', () => {
            console.log('🖱️ Botão de login clicado');
            console.log('🔧 Token client status:', !!tokenClient);
            console.log('🔧 CLIENT_ID sendo usado:', CLIENT_ID);
            
            if (tokenClient) {
                console.log('🚀 Iniciando popup do Google OAuth...');
                
                // Timeout para detectar erro automaticamente
                const errorTimeout = setTimeout(() => {
                    console.log('🔧 Timeout detectado - possível erro na autenticação');
                    errorMsg.textContent = 'Timeout na autenticação. Tente novamente.';
                    errorMsg.classList.remove('hidden');
                }, 3000);
                
                try {
                tokenClient.requestAccessToken();
                    
                    // Limpar timeout se funcionar
                    setTimeout(() => {
                        if (dadosUsuario) {
                            clearTimeout(errorTimeout);
                            console.log('✅ Usuário autenticado com sucesso');
                        }
                    }, 2000);
                } catch (error) {
                    clearTimeout(errorTimeout);
                    console.error('❌ Erro ao iniciar OAuth:', error);
                    errorMsg.innerHTML = `
                        <i class="fas fa-exclamation-triangle"></i>
                        <strong>Erro na autenticação:</strong><br>
                        ${error.message || 'Erro desconhecido'}<br>
                        <small>Tente novamente ou verifique sua conexão.</small>
                    `;
                    errorMsg.classList.remove('hidden');
                }
            } else {
                console.error('❌ Token client não inicializado');
                errorMsg.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <strong>Sistema de autenticação não configurado.</strong><br>
                    <small>Verifique se o CLIENT_ID está correto no arquivo .env</small>
                `;
                errorMsg.classList.remove('hidden');
            }
        });
        
        // 5. Verificar se já está logado
        verificarIdentificacao();
        
    } catch (error) {
        console.error("❌ Erro na inicialização do Google Sign-In:", error);
        errorMsg.textContent = 'Erro ao carregar autenticação do Google. Verifique sua conexão.';
        errorMsg.classList.remove('hidden');
        // Garantir que a interface fique oculta mesmo com erro
        showOverlay();
    }
}


// Funções de erro removidas - simplificadas para mensagens básicas






// ================== FUNÇÕES AUXILIARES ==================
async function logUserAccess(status) {
    if (!dadosUsuario?.email) return;
    
    try {
        await fetch('/api/logAccess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: dadosUsuario.email,
                nome: dadosUsuario.nome,
                status: status,
                timestamp: Date.now()
            })
        });
        console.log('📝 Log de acesso registrado:', status);
    } catch (error) {
        console.error("❌ Erro ao registrar acesso:", error);
    }
}

function logout() {
    console.log('🚪 Fazendo logout do usuário');
    
    // Limpar dados locais
    localStorage.removeItem('dadosUsuario');
    dadosUsuario = null;
    
    // Log de logout
    logUserAccess('offline');
    
    // Mostrar overlay de login
    showOverlay();
    
    // Limpar interface
    limparInterface();
}

function limparInterface() {
    // Limpar dados sensíveis da interface
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
        userInfo.textContent = '';
    }
    
    // Limpar formulários se necessário
    // ... sua lógica de limpeza aqui
}

// ================== FUNÇÃO PRINCIPAL DA APLICAÇÃO ==================
function iniciarAplicacao() {
    console.log('🚀 Iniciando aplicação para usuário:', dadosUsuario.nome);
    
    // Exemplo: mostrar nome do usuário
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
        userInfo.innerHTML = `
            <div class="d-flex align-items-center">
                <img src="${dadosUsuario.foto}" alt="Foto do usuário" class="rounded-circle me-2" width="28" height="28">
                <div>
                    <div class="fw-bold">${dadosUsuario.nome}</div>
                    <small class="text-muted">${dadosUsuario.funcao}</small>
                </div>
            </div>
        `;
    }
    
    // Exemplo: configurar botão de logout
    const logoutBtn = document.getElementById('logout-button');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    
    // Inicializar outras funcionalidades da aplicação
    if (typeof initializeBot === 'function') {
        initializeBot();
    }
    
    if (typeof setupEventListeners === 'function') {
        setupEventListeners();
    }
    
    if (typeof inicializarHistorico === 'function') {
        inicializarHistorico();
    }
    
    // Garantir que a interface esteja visível
    setTimeout(() => {
        if (appWrapper) {
            appWrapper.style.display = 'block';
            appWrapper.style.opacity = '1';
            appWrapper.style.visibility = 'visible';
            appWrapper.classList.add('authenticated');
            console.log('✅ Interface principal confirmada como visível');
            console.log('🔍 Estado do appWrapper:', {
                display: appWrapper.style.display,
                opacity: appWrapper.style.opacity,
                visibility: appWrapper.style.visibility,
                hasAuthenticatedClass: appWrapper.classList.contains('authenticated')
            });
        } else {
            console.error('❌ appWrapper não encontrado na confirmação');
        }
    }, 100);
}

// ================== FUNÇÕES DE VALIDAÇÃO ==================
function verificarPermissao(permissao) {
    if (!dadosUsuario) return false;
    
    const permissoes = {
        'admin': ['admin', 'gerente'],
        'relatorios': ['admin', 'gerente', 'analista'],
        'editar': ['admin', 'gerente'],
        'moderar': ['admin', 'gerente', 'moderador'],
        'visualizar': ['admin', 'gerente', 'analista', 'moderador', 'usuario']
    };
    
    return permissoes[permissao]?.includes(dadosUsuario.funcao?.toLowerCase()) || false;
}

function verificarExpiracao() {
    if (!dadosUsuario) return;
    
    const tempoExpiracao = 23 * 60 * 60 * 1000; // 23 horas
    if (Date.now() - dadosUsuario.timestamp > tempoExpiracao) {
        console.log('⏰ Sessão expirada, fazendo logout');
        logout();
    }
}

// ================== RECURSOS AVANÇADOS ==================
function renovarToken() {
    if (!dadosUsuario) return;
    
    const tempoExpiracao = 23 * 60 * 60 * 1000; // 23 horas
    if (Date.now() - dadosUsuario.timestamp > tempoExpiracao) {
        console.log('🔄 Renovando token de acesso');
        logout();
    }
}

function obterInformacoesUsuario() {
    if (!dadosUsuario) return null;
    
    return {
        nome: dadosUsuario.nome,
        email: dadosUsuario.email,
        funcao: dadosUsuario.funcao,
        departamento: dadosUsuario.departamento,
        foto: dadosUsuario.foto,
        ultimoAcesso: new Date(dadosUsuario.timestamp).toLocaleString('pt-BR')
    };
}

function verificarAcessoRecurso(recurso) {
    if (!dadosUsuario) return false;
    
    const recursos = {
        'reclame-aqui': ['admin', 'gerente', 'analista', 'moderador'],
        'moderacao': ['admin', 'gerente', 'moderador'],
        'relatorios': ['admin', 'gerente', 'analista'],
        'configuracoes': ['admin', 'gerente'],
        'usuarios': ['admin']
    };
    
    return recursos[recurso]?.includes(dadosUsuario.funcao?.toLowerCase()) || false;
}

// ================== INICIALIZAÇÃO ==================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🔐 Sistema de autenticação carregado');
    console.log('🌐 Hostname atual:', window.location.hostname);
    console.log('🌐 isVercel:', isVercel);
    console.log('🌐 isDevelopment:', isDevelopment);
    console.log('🔍 Verificando elementos DOM...');
    console.log('  - identificacaoOverlay:', !!identificacaoOverlay);
    console.log('  - appWrapper:', !!appWrapper);
    console.log('  - errorMsg:', !!errorMsg);
    
    // Autenticação obrigatória em todos os ambientes
    
    // Verificar identificação primeiro
    verificarIdentificacao();
    
    await initGoogleSignIn();
});

// Logout ao fechar a página
window.addEventListener('beforeunload', () => {
    if (dadosUsuario) {
        logUserAccess('offline');
    }
});

// Verificar expiração a cada hora
setInterval(verificarExpiracao, 60 * 60 * 1000);

// ================== EXPORTAR FUNÇÕES PARA USO GLOBAL ==================
window.auth = {
    dadosUsuario: () => dadosUsuario,
    logout: logout,
    verificarPermissao: verificarPermissao,
    verificarAcessoRecurso: verificarAcessoRecurso,
    obterInformacoesUsuario: obterInformacoesUsuario,
    renovarToken: renovarToken,
    isAuthenticated: () => !!dadosUsuario,
    getDominioPermitido: () => DOMINIO_PERMITIDO,
    getClientId: () => CLIENT_ID
};

// Função para testar Google Auth
function testarGoogleAuth() {
    console.log('🧪 Testando Google Auth...');
    console.log('🔧 CLIENT_ID atual:', CLIENT_ID);
    console.log('🔧 Google disponível:', !!window.google);
    console.log('🔧 Google.accounts disponível:', !!(window.google && window.google.accounts));
    
    if (window.google && window.google.accounts) {
        console.log('✅ Google Identity Services disponível, tentando inicializar...');
        try {
            const testClient = window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: 'profile email',
                callback: (response) => {
                    console.log('🧪 Teste de callback funcionou:', response);
                    if (response && response.access_token) {
                        console.log('✅ Teste bem-sucedido! OAuth funcionando.');
                        alert('✅ Teste bem-sucedido! O Google OAuth está funcionando.');
                    } else {
                        console.log('❌ Teste falhou: sem access_token');
                        alert('❌ Teste falhou: sem access_token');
                    }
                }
            });
            
            console.log('🚀 Iniciando teste de OAuth...');
            testClient.requestAccessToken();
        } catch (error) {
            console.error('❌ Erro no teste:', error);
            alert('❌ Erro no teste: ' + error.message);
        }
    } else {
        console.error('❌ Google Identity Services não disponível');
        alert('❌ Google Identity Services não disponível');
    }
}

// Função para mostrar instruções de configuração do Google OAuth

// Exportar funções para uso global
window.logout = logout;

// Função para testar o estado da autenticação
window.testarAutenticacao = function() {
    console.log('🧪 Testando estado da autenticação...');
    console.log('🔍 Dados do usuário:', dadosUsuario);
    console.log('🔍 Elementos DOM:', {
        overlay: !!identificacaoOverlay,
        wrapper: !!appWrapper,
        errorMsg: !!errorMsg
    });
    
    if (identificacaoOverlay) {
        console.log('🔍 Estado do overlay:', {
            display: identificacaoOverlay.style.display,
            opacity: identificacaoOverlay.style.opacity,
            visibility: identificacaoOverlay.style.visibility,
            hasHiddenClass: identificacaoOverlay.classList.contains('hidden')
        });
    }
    
    if (appWrapper) {
        console.log('🔍 Estado do appWrapper:', {
            display: appWrapper.style.display,
            opacity: appWrapper.style.opacity,
            visibility: appWrapper.style.visibility,
            hasAuthenticatedClass: appWrapper.classList.contains('authenticated')
        });
    }
    
    // Testar forçar exibição da interface
    if (dadosUsuario && appWrapper) {
        console.log('🔧 Forçando exibição da interface...');
        hideOverlay();
        iniciarAplicacao();
    } else {
        console.log('❌ Usuário não autenticado ou appWrapper não encontrado');
    }
};

// Função para forçar logout e mostrar overlay de login
window.forcarLogout = function() {
    console.log('🚪 Forçando logout e exibindo overlay de login...');
    
    // Limpar todos os dados
    localStorage.removeItem('dadosUsuario');
    dadosUsuario = null;
    
    // Forçar exibição do overlay
    showOverlay();
    
    console.log('✅ Logout forçado - overlay de login exibido');
};
