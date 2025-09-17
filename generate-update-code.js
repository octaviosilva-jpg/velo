// ===== GERADOR AUTOMÁTICO DE CÓDIGO DE ATUALIZAÇÃO VERCEL =====

const { execSync } = require('child_process');
const fs = require('fs');

// Obter informações do último commit
function getLastCommitInfo() {
    try {
        const commitHash = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
        const commitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
        const commitDate = execSync('git log -1 --pretty=%ci', { encoding: 'utf8' }).trim();
        const changedFiles = execSync('git diff-tree --no-commit-id --name-only -r HEAD', { encoding: 'utf8' })
            .trim().split('\n').filter(file => file.length > 0);
        
        return {
            hash: commitHash,
            message: commitMessage,
            date: commitDate,
            files: changedFiles
        };
    } catch (error) {
        console.error('Erro ao obter informações do commit:', error);
        return null;
    }
}

// Gerar código de atualização
function generateUpdateCode() {
    const commitInfo = getLastCommitInfo();
    if (!commitInfo) return null;

    const updateId = `VU-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`.toUpperCase();
    const timestamp = new Date().toISOString();
    
    // URL base da Vercel (será atualizada quando disponível)
    const vercelUrl = 'https://velo-xxx.vercel.app'; // Será substituída pela URL real
    
    const code = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                           🚀 ATUALIZAÇÃO VERCEL                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📋 ID da Atualização: ${updateId}                                    ║
║  📝 Descrição: ${commitInfo.message.padEnd(60)} ║
║  ⏰ Data/Hora: ${new Date(timestamp).toLocaleString('pt-BR')}                    ║
║  📦 Commit Hash: ${commitInfo.hash}                                    ║
║  🌐 URL Vercel: ${vercelUrl}                                    ║
║  📁 Arquivos Modificados: ${commitInfo.files.length} arquivo(s)                                        ║
║                                                                              ║`;

    let finalCode = code;
    
    if (commitInfo.files.length > 0) {
        finalCode += `\n║  📄 Lista de Arquivos:                                                      ║`;
        commitInfo.files.forEach(file => {
            finalCode += `\n║     • ${file.padEnd(65)} ║`;
        });
    }

    finalCode += `
║                                                                              ║
║  🔄 Status: ⏳ DEPLOY EM ANDAMENTO                                          ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

🎯 PRÓXIMOS PASSOS:
1. Aguarde 2-3 minutos para o deploy automático na Vercel
2. Acesse: ${vercelUrl}
3. Teste as funcionalidades implementadas
4. Verifique se tudo está funcionando corretamente

📊 INFORMAÇÕES TÉCNICAS:
• Repositório: https://github.com/octaviosilva-jpg/velo
• Branch: main
• Deploy: Automático via Vercel
• Status: Deploy em andamento

🔍 COMO VERIFICAR O DEPLOY:
1. Acesse: https://vercel.com/dashboard
2. Selecione o projeto "velo"
3. Vá em "Deployments"
4. Verifique se o último commit está com status "Ready"

⏱️ TEMPO ESTIMADO DE DEPLOY: 2-3 minutos
`;

    return finalCode;
}

// Executar se chamado diretamente
if (require.main === module) {
    const updateCode = generateUpdateCode();
    if (updateCode) {
        console.log(updateCode);
        
        // Salvar em arquivo para referência
        fs.writeFileSync('last-update-code.txt', updateCode);
        console.log('\n📄 Código salvo em: last-update-code.txt');
    }
}

module.exports = { generateUpdateCode, getLastCommitInfo };
