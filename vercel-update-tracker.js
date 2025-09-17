// ===== SISTEMA DE RASTREAMENTO DE ATUALIZAÇÕES VERCEL =====

class VercelUpdateTracker {
    constructor() {
        this.updates = [];
        this.currentUpdate = null;
    }

    // Iniciar nova atualização
    startUpdate(description, files = []) {
        const updateId = this.generateUpdateId();
        this.currentUpdate = {
            id: updateId,
            description: description,
            files: files,
            timestamp: new Date().toISOString(),
            status: 'in_progress',
            vercelUrl: null,
            commitHash: null
        };
        
        console.log(`🚀 Iniciando atualização: ${description}`);
        console.log(`📝 ID da atualização: ${updateId}`);
        return updateId;
    }

    // Finalizar atualização com informações da Vercel
    completeUpdate(updateId, vercelUrl, commitHash) {
        if (this.currentUpdate && this.currentUpdate.id === updateId) {
            this.currentUpdate.status = 'completed';
            this.currentUpdate.vercelUrl = vercelUrl;
            this.currentUpdate.commitHash = commitHash;
            this.currentUpdate.completedAt = new Date().toISOString();
            
            this.updates.push({...this.currentUpdate});
            
            console.log(`✅ Atualização concluída: ${updateId}`);
            console.log(`🌐 URL Vercel: ${vercelUrl}`);
            console.log(`📦 Commit: ${commitHash}`);
            
            // Gerar código de atualização
            const updateCode = this.generateUpdateCode(this.currentUpdate);
            console.log(`\n📋 CÓDIGO DE ATUALIZAÇÃO VERCEL:`);
            console.log(`\n${updateCode}\n`);
            
            return updateCode;
        }
    }

    // Gerar ID único para atualização
    generateUpdateId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 5);
        return `VU-${timestamp}-${random}`.toUpperCase();
    }

    // Gerar código de atualização formatado
    generateUpdateCode(update) {
        const code = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                           🚀 ATUALIZAÇÃO VERCEL                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📋 ID da Atualização: ${update.id}                                    ║
║  📝 Descrição: ${update.description.padEnd(60)} ║
║  ⏰ Data/Hora: ${new Date(update.timestamp).toLocaleString('pt-BR')}                    ║
║  📦 Commit Hash: ${update.commitHash || 'Pendente'}                                    ║
║  🌐 URL Vercel: ${update.vercelUrl || 'Pendente'}                                    ║
║  📁 Arquivos Modificados: ${update.files.length} arquivo(s)                                        ║
║                                                                              ║`;

        if (update.files.length > 0) {
            code += `\n║  📄 Lista de Arquivos:                                                      ║`;
            update.files.forEach(file => {
                code += `\n║     • ${file.padEnd(65)} ║`;
            });
        }

        code += `
║                                                                              ║
║  🔄 Status: ${update.status === 'completed' ? '✅ CONCLUÍDA' : '⏳ EM ANDAMENTO'}                                    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

🎯 PRÓXIMOS PASSOS:
1. Aguarde 2-3 minutos para o deploy automático na Vercel
2. Acesse: ${update.vercelUrl || 'URL será disponibilizada após deploy'}
3. Teste as funcionalidades implementadas
4. Verifique se tudo está funcionando corretamente

📊 HISTÓRICO DE ATUALIZAÇÕES:
${this.getUpdateHistory()}
`;

        return code;
    }

    // Obter histórico de atualizações
    getUpdateHistory() {
        if (this.updates.length === 0) return 'Nenhuma atualização anterior.';
        
        return this.updates.slice(-5).map(update => 
            `• ${update.id} - ${update.description} (${new Date(update.timestamp).toLocaleDateString('pt-BR')})`
        ).join('\n');
    }

    // Obter código da última atualização
    getLastUpdateCode() {
        if (this.updates.length === 0) return null;
        const lastUpdate = this.updates[this.updates.length - 1];
        return this.generateUpdateCode(lastUpdate);
    }
}

// Instância global do tracker
const vercelTracker = new VercelUpdateTracker();

// Função para iniciar atualização
function startVercelUpdate(description, files = []) {
    return vercelTracker.startUpdate(description, files);
}

// Função para completar atualização
function completeVercelUpdate(updateId, vercelUrl, commitHash) {
    return vercelTracker.completeUpdate(updateId, vercelUrl, commitHash);
}

// Função para obter código da última atualização
function getLastUpdateCode() {
    return vercelTracker.getLastUpdateCode();
}

// Exportar para uso global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        VercelUpdateTracker,
        startVercelUpdate,
        completeVercelUpdate,
        getLastUpdateCode
    };
} else {
    window.VercelUpdateTracker = VercelUpdateTracker;
    window.startVercelUpdate = startVercelUpdate;
    window.completeVercelUpdate = completeVercelUpdate;
    window.getLastUpdateCode = getLastUpdateCode;
}
