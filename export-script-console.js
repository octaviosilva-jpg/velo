// ================== SCRIPT PARA COPIAR E COLAR NO CONSOLE ==================
// Copie e cole este código no console do navegador na Vercel

(function() {
    console.log('🔄 Iniciando exportação dos dados do localStorage...');
    
    try {
        // 1. Coletar dados do localStorage
        const modelosRespostas = JSON.parse(localStorage.getItem('modelos_respostas_coerentes') || '[]');
        const aprendizadoScript = JSON.parse(localStorage.getItem('aprendizado_script') || '{}');
        
        console.log(`📊 Dados encontrados:`);
        console.log(`- Modelos de respostas: ${modelosRespostas.length}`);
        console.log(`- Aprendizado do script: ${Object.keys(aprendizadoScript).length > 0 ? 'Sim' : 'Não'}`);
        
        if (modelosRespostas.length === 0) {
            console.log('❌ Nenhum modelo encontrado no localStorage');
            return;
        }
        
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
        console.log('📁 Salve o arquivo na pasta do projeto e execute: node import-localstorage-data.js arquivo-baixado.json');
        
        // 5. Mostrar resumo dos dados
        console.log('📋 Resumo dos dados exportados:');
        modelosRespostas.forEach((modelo, index) => {
            console.log(`${index + 1}. ID: ${modelo.id}, Tipo: ${modelo.tipo_situacao}, Data: ${modelo.timestamp}`);
        });
        
        return dadosParaExportar;
        
    } catch (error) {
        console.error('❌ Erro ao exportar dados:', error);
        return null;
    }
})();
