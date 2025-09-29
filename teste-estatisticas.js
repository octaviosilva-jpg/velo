// Teste para verificar se as estatísticas estão sendo incrementadas
const fs = require('fs');

// Carregar estatísticas atuais
function loadEstatisticasGlobais() {
    try {
        if (fs.existsSync('./data/estatisticas_globais.json')) {
            const data = fs.readFileSync('./data/estatisticas_globais.json', 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar estatísticas:', error);
    }
    return null;
}

// Testar incremento de estatísticas
async function testarIncrementoEstatisticas() {
    console.log('🧪 TESTE DE INCREMENTO DE ESTATÍSTICAS');
    console.log('=====================================');
    
    // Carregar estatísticas atuais
    const estatisticas = loadEstatisticasGlobais();
    if (!estatisticas) {
        console.log('❌ Não foi possível carregar estatísticas');
        return;
    }
    
    console.log('📊 Estatísticas atuais:');
    console.log('  - Respostas geradas:', estatisticas.estatisticas.respostas_geradas);
    console.log('  - Respostas coerentes:', estatisticas.estatisticas.respostas_coerentes);
    console.log('  - Moderações geradas:', estatisticas.estatisticas.moderacoes_geradas);
    console.log('  - Moderações coerentes:', estatisticas.estatisticas.moderacoes_coerentes);
    console.log('  - Revisões texto:', estatisticas.estatisticas.revisoes_texto);
    console.log('  - Explicações geradas:', estatisticas.estatisticas.explicacoes_geradas);
    
    console.log('\n📅 Histórico diário:');
    estatisticas.historico_diario.forEach((entrada, index) => {
        console.log(`  ${index + 1}. ${entrada.data}:`);
        console.log(`     - Respostas: ${entrada.respostas_geradas || 0}`);
        console.log(`     - Moderações: ${entrada.moderacoes_geradas || 0}`);
        console.log(`     - Explicações: ${entrada.explicacoes_geradas || 0}`);
    });
    
    console.log('\n✅ Teste concluído!');
}

// Executar teste
testarIncrementoEstatisticas();
