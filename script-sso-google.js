// ================== SCRIPT DE AUTENTICAÇÃO GOOGLE SSO ==================
// Este arquivo contém as funções de autenticação Google OAuth 2.0
// para o sistema Velotax Bot

// Configurações globais
let CLIENT_ID = null;
let DOMINIO_PERMITIDO = '@velotax.com.br';
let dadosUsuario = null;

// ================== FUNÇÕES DE CONFIGURAÇÃO ==================

// Carregar configurações do servidor
async function carregarConfiguracoes() {
    try {
        console.log('🔧 Carregando configurações do servidor...');
        const response = await fetch('/api/google-config');
        const config = await response.json();
        
        if (config.success) {
            CLIENT_ID = config.clientId;
            DOMINIO_PERMITIDO = config.dominioPermitido;
            console.log('✅ Configurações carregadas:', { CLIENT_ID, DOMINIO_PERMITIDO });
        } else {
            console.error('❌ Erro ao carregar configurações:', config.error);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar configurações:', error);
    }
}

// ================== FUNÇÕES DE AUTENTICAÇÃO ==================

// Inicializar Google Sign-In
async function initGoogleSignIn() {
    try {
        console.log('🚀 Inicializando Google Sign-In...');
        
        // Carregar configurações primeiro
        await carregarConfiguracoes();
        
        if (!CLIENT_ID || CLIENT_ID === 'SEU_CLIENT_ID_AQUI') {
            console.error('❌ CLIENT_ID não configurado');
            showGoogleConfigError();
            return;
        }
        
        // Verificar se o Google Identity Services está carregado
        if (typeof google === 'undefined' || !google.accounts) {
            console.error('❌ Google Identity Services não carregado');
            return;
        }
        
        // Inicializar Google Identity Services
        google.accounts.id.initialize({
            client_id: CLIENT_ID,
            callback: handleGoogleSignIn,
            auto_select: false,
            cancel_on_tap_outside: true
        });
        
        console.log('✅ Google Sign-In inicializado com sucesso');
        
        // Mostrar overlay de login
        showOverlay();
        
    } catch (error) {
        console.error('❌ Erro na inicialização do Google Sign-In:', error);
        showGoogleConfigError();
    }
}

// Manipular resposta do Google Sign-In
function handleGoogleSignIn(response) {
    try {
        console.log('🔐 Resposta do Google Sign-In recebida');
        
        if (response.credential) {
            // Decodificar o token JWT
            const payload = JSON.parse(atob(response.credential.split('.')[1]));
            console.log('👤 Dados do usuário:', payload);
            
            // Verificar domínio
            if (payload.email && payload.email.endsWith(DOMINIO_PERMITIDO)) {
                dadosUsuario = {
                    nome: payload.name,
                    email: payload.email,
                    foto: payload.picture,
                    funcao: 'Usuário'
                };
                
                console.log('✅ Usuário autenticado:', dadosUsuario);
                iniciarAplicacao();
            } else {
                console.error('❌ Domínio não autorizado:', payload.email);
                alert('Acesso negado. Apenas usuários com domínio @velotax.com.br são autorizados.');
            }
        } else {
            console.error('❌ Credencial não recebida');
        }
    } catch (error) {
        console.error('❌ Erro ao processar resposta do Google:', error);
    }
}

// ================== FUNÇÕES DE INTERFACE ==================

// Mostrar overlay de login
function showOverlay() {
    const overlay = document.getElementById('identificacao-overlay');
    const wrapper = document.querySelector('.app-wrapper');
    
    if (overlay) {
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
        overlay.style.visibility = 'visible';
        overlay.style.zIndex = '99999';
        overlay.classList.remove('hidden');
    }
    
    if (wrapper) {
        wrapper.style.display = 'none';
        wrapper.style.opacity = '0';
        wrapper.style.visibility = 'hidden';
        wrapper.classList.remove('authenticated');
    }
    
    console.log('🔒 Overlay de login exibido');
}

// Esconder overlay de login
function hideOverlay() {
    const overlay = document.getElementById('identificacao-overlay');
    const wrapper = document.querySelector('.app-wrapper');
    
    if (overlay) {
        overlay.style.display = 'none';
        overlay.style.opacity = '0';
        overlay.style.visibility = 'hidden';
        overlay.classList.add('hidden');
    }
    
    if (wrapper) {
        wrapper.style.display = 'block';
        wrapper.style.opacity = '1';
        wrapper.style.visibility = 'visible';
        wrapper.classList.add('authenticated');
    }
    
    console.log('🔓 Overlay de login oculto');
}

// Mostrar erro de configuração do Google
function showGoogleConfigError() {
    const overlay = document.getElementById('identificacao-overlay');
    if (overlay) {
        overlay.innerHTML = `
            <div class="login-box">
                <h2>Configuração Necessária</h2>
                <p>O CLIENT_ID do Google OAuth precisa ser configurado para localhost.</p>
                <p>Configure o CLIENT_ID no arquivo .env</p>
                <button onclick="location.reload()" class="btn btn-primary">Recarregar</button>
            </div>
        `;
    }
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
    
    // Inicializar bot
    if (typeof initializeBot === 'function') {
        initializeBot();
    }
    
    // Esconder overlay e mostrar aplicação
    hideOverlay();
}

// ================== FUNÇÕES DE LOGOUT ==================

function logout() {
    console.log('🚪 Fazendo logout...');
    
    // Limpar dados do usuário
    dadosUsuario = null;
    
    // Limpar interface
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
        userInfo.innerHTML = '';
    }
    
    // Mostrar overlay de login novamente
    showOverlay();
    
    console.log('✅ Logout realizado');
}

// ================== INICIALIZAÇÃO ==================

// Verificar identificação quando a página carregar
function verificarIdentificacao() {
    console.log('🔍 Verificando identificação...');
    
    if (dadosUsuario) {
        console.log('✅ Usuário já autenticado');
        iniciarAplicacao();
    } else {
        console.log('🔒 Usuário não autenticado, mostrando overlay');
        showOverlay();
    }
}

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM carregado, inicializando autenticação...');
    verificarIdentificacao();
    initGoogleSignIn();
});

// Exportar funções para uso global
window.velotaxAuth = {
    initGoogleSignIn,
    handleGoogleSignIn,
    showOverlay,
    hideOverlay,
    iniciarAplicacao,
    logout,
    verificarIdentificacao
};
