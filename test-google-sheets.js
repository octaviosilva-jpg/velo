/**
 * Script de teste para a integração com Google Sheets
 * Execute este script para testar se a integração está funcionando
 */

// Carregar variáveis de ambiente do config.env
require('dotenv').config({ path: './config.env' });

const googleSheetsIntegration = require('./google-sheets-integration');

async function testarIntegracao() {
    console.log('🧪 Iniciando teste da integração com Google Sheets...\n');

    try {
        // 1. Inicializar a integração
        console.log('1️⃣ Inicializando integração...');
        const inicializada = await googleSheetsIntegration.initialize();
        
        if (!inicializada) {
            console.log('❌ Integração não pôde ser inicializada');
            console.log('📋 Verifique:');
            console.log('   - Se o arquivo google-sheets-credentials.json existe');
            console.log('   - Se o arquivo google-sheets-token.json existe');
            console.log('   - Se o GOOGLE_SHEETS_ID está configurado no config.env');
            console.log('   - Se ENABLE_GOOGLE_SHEETS=true no config.env');
            return;
        }

        console.log('✅ Integração inicializada com sucesso\n');

        // 2. Testar registro de feedback
        console.log('2️⃣ Testando registro de feedback...');
        const feedbackData = {
            id: Date.now(),
            tipo: 'resposta',
            textoCliente: 'Cliente solicita esclarecimento sobre cobrança',
            respostaAnterior: 'Resposta inicial do sistema',
            feedback: 'Melhorar tom e incluir mais detalhes',
            respostaReformulada: 'Resposta reformulada com melhor tom',
            dadosFormulario: {
                tipo_solicitacao: 'esclarecimento',
                motivo_solicitacao: 'cobranca',
                solucao_implementada: 'Esclarecimento fornecido',
                historico_atendimento: 'Primeiro contato',
                observacoes_internas: 'Cliente satisfeito'
            }
        };

        const feedbackRegistrado = await googleSheetsIntegration.registrarFeedback(feedbackData);
        console.log(feedbackRegistrado ? '✅ Feedback registrado' : '❌ Erro ao registrar feedback');

        // 3. Testar registro de resposta coerente
        console.log('\n3️⃣ Testando registro de resposta coerente...');
        const respostaData = {
            id: Date.now() + 1,
            tipo: 'resposta',
            textoCliente: 'Cliente solicita cancelamento de serviço',
            respostaFinal: 'Resposta final aprovada para cancelamento',
            dadosFormulario: {
                tipo_solicitacao: 'cancelamento',
                motivo_solicitacao: 'insatisfacao',
                solucao_implementada: 'Cancelamento processado',
                historico_atendimento: 'Múltiplos contatos',
                observacoes_internas: 'Processo concluído'
            }
        };

        const respostaRegistrada = await googleSheetsIntegration.registrarRespostaCoerente(respostaData);
        console.log(respostaRegistrada ? '✅ Resposta coerente registrada' : '❌ Erro ao registrar resposta');

        // 4. Testar registro de acesso
        console.log('\n4️⃣ Testando registro de acesso...');
        const acessoData = {
            acao: 'Teste de Integração',
            usuario: 'teste@velotax.com.br',
            ip: '127.0.0.1',
            userAgent: 'Test Script',
            duracaoSessao: 5,
            status: 'Sucesso'
        };

        const acessoRegistrado = await googleSheetsIntegration.registrarAcessoInterface(acessoData);
        console.log(acessoRegistrado ? '✅ Acesso registrado' : '❌ Erro ao registrar acesso');

        // 5. Testar registro de estatísticas
        console.log('\n5️⃣ Testando registro de estatísticas...');
        const estatisticas = {
            respostas_geradas: 10,
            respostas_coerentes: 8,
            moderacoes_geradas: 5,
            moderacoes_coerentes: 4,
            revisoes_texto: 3,
            explicacoes_geradas: 2
        };

        const estatisticasRegistradas = await googleSheetsIntegration.registrarEstatisticas(estatisticas);
        console.log(estatisticasRegistradas ? '✅ Estatísticas registradas' : '❌ Erro ao registrar estatísticas');

        console.log('\n🎉 Teste concluído com sucesso!');
        console.log('📊 Verifique sua planilha do Google Sheets para ver os dados registrados.');

    } catch (error) {
        console.error('💥 Erro durante o teste:', error.message);
        console.log('\n🔧 Possíveis soluções:');
        console.log('1. Verifique se o arquivo google-sheets-credentials.json está correto');
        console.log('2. Execute: node google-sheets-auth.js para obter novo token');
        console.log('3. Verifique se o GOOGLE_SHEETS_ID está correto');
        console.log('4. Certifique-se de que a Google Sheets API está habilitada');
    }
}

// Executar teste se chamado diretamente
if (require.main === module) {
    testarIntegracao()
        .then(() => {
            console.log('\n✅ Teste finalizado');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Falha no teste:', error.message);
            process.exit(1);
        });
}

module.exports = { testarIntegracao };
