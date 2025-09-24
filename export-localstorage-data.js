// ================== EXPORTADOR DE DADOS DO LOCALSTORAGE ==================
// Script para exportar dados salvos no localStorage da Vercel para arquivos JSON locais
// Execute este script no console do navegador quando estiver na Vercel

function exportarDadosLocalStorage() {
    console.log('🔄 Iniciando exportação dos dados do localStorage...');
    
    try {
        // 1. Coletar dados do localStorage
        const modelosRespostas = JSON.parse(localStorage.getItem('modelos_respostas_coerentes') || '[]');
        const aprendizadoScript = JSON.parse(localStorage.getItem('aprendizado_script') || '{}');
        
        console.log(`📊 Dados encontrados:`);
        console.log(`- Modelos de respostas: ${modelosRespostas.length}`);
        console.log(`- Aprendizado do script: ${Object.keys(aprendizadoScript).length > 0 ? 'Sim' : 'Não'}`);
        
        // 2. Preparar dados para download
        const dadosParaExportar = {
            modelosRespostas: modelosRespostas,
            aprendizadoScript: aprendizadoScript,
            timestamp: new Date().toISOString(),
            origem: 'localStorage Vercel'
        };
        
        // 3. Criar arquivo JSON para download
        const jsonString = JSON.stringify(dadosParaExportar, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // 4. Criar link de download
        const link = document.createElement('a');
        link.href = url;
        link.download = `velotax-bot-dados-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log('✅ Arquivo JSON criado e baixado com sucesso!');
        console.log('📁 Salve o arquivo na pasta do projeto e execute o script de importação');
        
        // 5. Mostrar resumo dos dados
        console.log('📋 Resumo dos dados exportados:');
        console.log('Modelos de respostas:', modelosRespostas.map(m => ({
            id: m.id,
            tipo_situacao: m.tipo_situacao,
            timestamp: m.timestamp
        })));
        
        return dadosParaExportar;
        
    } catch (error) {
        console.error('❌ Erro ao exportar dados:', error);
        return null;
    }
}

// Função para mostrar dados do localStorage
function mostrarDadosLocalStorage() {
    console.log('📊 Dados atuais no localStorage:');
    
    const modelosRespostas = JSON.parse(localStorage.getItem('modelos_respostas_coerentes') || '[]');
    const aprendizadoScript = JSON.parse(localStorage.getItem('aprendizado_script') || '{}');
    
    console.log(`- Modelos de respostas: ${modelosRespostas.length}`);
    console.log(`- Aprendizado do script: ${Object.keys(aprendizadoScript).length > 0 ? 'Sim' : 'Não'}`);
    
    if (modelosRespostas.length > 0) {
        console.log('Últimos 3 modelos:');
        modelosRespostas.slice(-3).forEach((modelo, index) => {
            console.log(`${index + 1}. ID: ${modelo.id}, Tipo: ${modelo.tipo_situacao}, Data: ${modelo.timestamp}`);
        });
    }
    
    return { modelosRespostas, aprendizadoScript };
}

// Função para limpar dados do localStorage (opcional)
function limparDadosLocalStorage() {
    if (confirm('⚠️ Tem certeza que deseja limpar todos os dados do localStorage?')) {
        localStorage.removeItem('modelos_respostas_coerentes');
        localStorage.removeItem('aprendizado_script');
        console.log('🧹 Dados do localStorage limpos');
    }
}

// Instruções de uso
console.log('🚀 Script de exportação carregado!');
console.log('📋 Comandos disponíveis:');
console.log('1. exportarDadosLocalStorage() - Exporta dados para arquivo JSON');
console.log('2. mostrarDadosLocalStorage() - Mostra dados atuais');
console.log('3. limparDadosLocalStorage() - Limpa dados (cuidado!)');
console.log('');
console.log('💡 Para usar:');
console.log('1. Execute: exportarDadosLocalStorage()');
console.log('2. Baixe o arquivo JSON');
console.log('3. Salve na pasta do projeto');
console.log('4. Execute o script de importação local');

// Executar automaticamente a visualização
mostrarDadosLocalStorage();
