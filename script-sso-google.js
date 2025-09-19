// ================== CONFIGURAÇÕES ==================
const DOMINIO_PERMITIDO = "@seu-dominio.com"; // Altere para seu domínio
const CLIENT_ID = 'SEU_CLIENT_ID_AQUI'; // Obtenha no Google Cloud Console

// ================== ELEMENTOS DO DOM ==================
const identificacaoOverlay = document.getElementById('identificacao-overlay');
const appWrapper = document.querySelector('.app-wrapper');
const errorMsg = document.getElementById('identificacao-error');

// ================== VARIÁVEIS DE ESTADO ==================
let dadosUsuario = null;
let tokenClient = null;

// ================== FUNÇÕES DE CONTROLE DE UI ==================
function showOverlay() {
    identificacaoOverlay.classList.remove('hidden');
    appWrapper.classList.add('hidden');
}

function hideOverlay() {
    identificacaoOverlay.classList.add('hidden');
    appWrapper.classList.remove('hidden');
}

// ================== LÓGICA DE AUTENTICAÇÃO ==================
function waitForGoogleScript() {
    return new Promise((resolve, reject) => {
        const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
        if (!script) {
            return reject(new Error('Script Google Identity Services não encontrado no HTML.'));
        }
        
        if (window.google && window.google.accounts) {
            return resolve(window.google.accounts);
        }
        
        script.onload = () => {
            if (window.google && window.google.accounts) {
                resolve(window.google.accounts);
            } else {
                reject(new Error('Google Identity Services não carregou corretamente.'));
            }
        };
        
        script.onerror = () => reject(new Error('Erro ao carregar o script Google Identity Services.'));
    });
}

async function handleGoogleSignIn(response) {
    try {
        // 1. Buscar dados do usuário na API do Google
        const googleResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${response.access_token}` }
        });
        const user = await googleResponse.json();

        // 2. Validar domínio corporativo
        if (user.email && user.email.endsWith(DOMINIO_PERMITIDO)) {
            // 3. Buscar perfil adicional (opcional)
            const profileResponse = await fetch(`/api/getUserProfile?email=${encodeURIComponent(user.email)}`);
            let userProfile = {};
            
            if (profileResponse.ok) {
                userProfile = await profileResponse.json();
            }

            // 4. Salvar dados do usuário
            dadosUsuario = {
                nome: user.name,
                email: user.email,
                foto: user.picture,
                timestamp: Date.now(),
                funcao: userProfile.funcao || 'Usuário'
            };

            // 5. Persistir no localStorage
            localStorage.setItem('dadosUsuario', JSON.stringify(dadosUsuario));
            
            // 6. Log de acesso (opcional)
            await logUserAccess('online');
            
            // 7. Iniciar aplicação
            hideOverlay();
            iniciarAplicacao();
            
        } else {
            // Domínio não permitido
            errorMsg.textContent = `Acesso permitido apenas para e-mails ${DOMINIO_PERMITIDO}!`;
            errorMsg.classList.remove('hidden');
        }
        
    } catch (error) {
        console.error("Erro no fluxo de login:", error);
        errorMsg.textContent = 'Erro ao verificar login ou permissões. Tente novamente.';
        errorMsg.classList.remove('hidden');
    }
}

function verificarIdentificacao() {
    const umDiaEmMs = 24 * 60 * 60 * 1000; // 24 horas
    let dadosSalvos = null;
    
    try {
        const dadosSalvosString = localStorage.getItem('dadosUsuario');
        if (dadosSalvosString) {
            dadosSalvos = JSON.parse(dadosSalvosString);
        }
    } catch (e) {
        localStorage.removeItem('dadosUsuario');
    }

    // Verificar se há dados válidos e não expirados
    if (dadosSalvos && 
        dadosSalvos.email && 
        dadosSalvos.email.endsWith(DOMINIO_PERMITIDO) && 
        (Date.now() - dadosSalvos.timestamp < umDiaEmMs)) {
        
        dadosUsuario = dadosSalvos;
        logUserAccess('online');
        hideOverlay();
        iniciarAplicacao();
        
    } else {
        // Dados inválidos ou expirados
        localStorage.removeItem('dadosUsuario');
        showOverlay();
    }
}

function initGoogleSignIn() {
    waitForGoogleScript().then(accounts => {
        // Configurar cliente OAuth
        tokenClient = accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: 'profile email',
            callback: handleGoogleSignIn
        });
        
        // Configurar botão de login
        document.getElementById('google-signin-button').addEventListener('click', () => {
            tokenClient.requestAccessToken();
        });
        
        // Verificar se já está logado
        verificarIdentificacao();
        
    }).catch(error => {
        console.error("Erro na inicialização do Google Sign-In:", error);
        errorMsg.textContent = 'Erro ao carregar autenticação do Google. Verifique sua conexão.';
        errorMsg.classList.remove('hidden');
    });
}

// ================== FUNÇÕES AUXILIARES ==================
async function logUserAccess(status) {
    if (!dadosUsuario?.email) return;
    
    try {
        await fetch('/api/logAccess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: dadosUsuario.email,
                status: status,
                timestamp: Date.now()
            })
        });
    } catch (error) {
        console.error("Erro ao registrar acesso:", error);
    }
}

function logout() {
    // Limpar dados locais
    localStorage.removeItem('dadosUsuario');
    dadosUsuario = null;
    
    // Log de logout
    logUserAccess('offline');
    
    // Mostrar overlay de login
    showOverlay();
    
    // Limpar interface
    // ... sua lógica de limpeza aqui
}

// ================== INICIALIZAÇÃO ==================
document.addEventListener('DOMContentLoaded', () => {
    initGoogleSignIn();
});

// Logout ao fechar a página
window.addEventListener('beforeunload', () => {
    if (dadosUsuario) {
        logUserAccess('offline');
    }
});

// ================== FUNÇÃO PRINCIPAL DA APLICAÇÃO ==================
function iniciarAplicacao() {
    // Sua lógica de inicialização da aplicação aqui
    console.log('Usuário logado:', dadosUsuario);
    
    // Exemplo: mostrar nome do usuário
    const userInfo = document.getElementById('user-info');
    if (userInfo) {
        userInfo.textContent = `Olá, ${dadosUsuario.nome}!`;
    }
    
    // Exemplo: configurar botão de logout
    const logoutBtn = document.getElementById('logout-button');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

// ================== RECURSOS AVANÇADOS ==================
function verificarPermissao(permissao) {
    if (!dadosUsuario) return false;
    
    const permissoes = {
        'admin': ['admin', 'gerente'],
        'relatorios': ['admin', 'gerente', 'analista'],
        'editar': ['admin', 'gerente']
    };
    
    return permissoes[permissao]?.includes(dadosUsuario.funcao) || false;
}

function verificarExpiracao() {
    if (!dadosUsuario) return;
    
    const tempoExpiracao = 23 * 60 * 60 * 1000; // 23 horas
    if (Date.now() - dadosUsuario.timestamp > tempoExpiracao) {
        logout();
    }
}

// Verificar a cada hora
setInterval(verificarExpiracao, 60 * 60 * 1000);

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
