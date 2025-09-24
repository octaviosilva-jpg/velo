// ================== IMPORTADOR DE DADOS PARA ARQUIVOS JSON ==================
// Script para importar dados exportados do localStorage para os arquivos JSON locais
// Execute este script no Node.js local

const fs = require('fs');
const path = require('path');

// Caminhos dos arquivos
const MODELOS_RESPOSTAS_FILE = path.join(__dirname, 'data', 'modelos_respostas.json');
const APRENDIZADO_SCRIPT_FILE = path.join(__dirname, 'data', 'aprendizado_script.json');

function obterTimestampBrasil() {
    const agora = new Date();
    const offsetBrasil = -3 * 60; // UTC-3
    const dataBrasil = new Date(agora.getTime() + (offsetBrasil * 60 * 1000));
    
    return dataBrasil.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function carregarArquivoJSON(caminho) {
    try {
        if (fs.existsSync(caminho)) {
            const conteudo = fs.readFileSync(caminho, 'utf8');
            return JSON.parse(conteudo);
        }
        return { modelos: [], lastUpdated: obterTimestampBrasil() };
    } catch (error) {
        console.error(`❌ Erro ao carregar ${caminho}:`, error.message);
        return { modelos: [], lastUpdated: obterTimestampBrasil() };
    }
}

function salvarArquivoJSON(caminho, dados) {
    try {
        const dir = path.dirname(caminho);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(caminho, JSON.stringify(dados, null, 2));
        console.log(`✅ Arquivo salvo: ${caminho}`);
        return true;
    } catch (error) {
        console.error(`❌ Erro ao salvar ${caminho}:`, error.message);
        return false;
    }
}

function importarDadosDoLocalStorage(arquivoExportado) {
    console.log('🔄 Iniciando importação dos dados do localStorage...');
    
    try {
        // 1. Carregar dados exportados
        const dadosExportados = JSON.parse(fs.readFileSync(arquivoExportado, 'utf8'));
        
        console.log('📊 Dados encontrados no arquivo:');
        console.log(`- Modelos de respostas: ${dadosExportados.modelosRespostas?.length || 0}`);
        console.log(`- Aprendizado do script: ${Object.keys(dadosExportados.aprendizadoScript || {}).length > 0 ? 'Sim' : 'Não'}`);
        console.log(`- Origem: ${dadosExportados.origem}`);
        console.log(`- Timestamp: ${dadosExportados.timestamp}`);
        
        let resultados = {
            modelosRespostas: { sucesso: false, adicionados: 0, duplicados: 0 },
            aprendizadoScript: { sucesso: false, atualizado: false }
        };
        
        // 2. Importar modelos de respostas
        if (dadosExportados.modelosRespostas && Array.isArray(dadosExportados.modelosRespostas)) {
            console.log('📝 Importando modelos de respostas...');
            
            const dadosExistentes = carregarArquivoJSON(MODELOS_RESPOSTAS_FILE);
            const modelosExistentes = dadosExistentes.modelos || [];
            
            // Adicionar novos modelos (evitar duplicatas)
            const novosModelos = dadosExportados.modelosRespostas.filter(novoModelo => 
                !modelosExistentes.some(existente => existente.id === novoModelo.id)
            );
            
            if (novosModelos.length > 0) {
                dadosExistentes.modelos = [...modelosExistentes, ...novosModelos];
                dadosExistentes.lastUpdated = obterTimestampBrasil();
                
                if (salvarArquivoJSON(MODELOS_RESPOSTAS_FILE, dadosExistentes)) {
                    resultados.modelosRespostas = {
                        sucesso: true,
                        adicionados: novosModelos.length,
                        duplicados: dadosExportados.modelosRespostas.length - novosModelos.length
                    };
                    console.log(`✅ ${novosModelos.length} novos modelos adicionados`);
                    console.log(`⚠️ ${dadosExportados.modelosRespostas.length - novosModelos.length} modelos duplicados ignorados`);
                }
            } else {
                resultados.modelosRespostas = {
                    sucesso: true,
                    adicionados: 0,
                    duplicados: dadosExportados.modelosRespostas.length
                };
                console.log('ℹ️ Nenhum modelo novo para adicionar (todos já existem)');
            }
        }
        
        // 3. Importar aprendizado do script
        if (dadosExportados.aprendizadoScript && typeof dadosExportados.aprendizadoScript === 'object') {
            console.log('🧠 Importando aprendizado do script...');
            
            const dadosExistentes = carregarArquivoJSON(APRENDIZADO_SCRIPT_FILE);
            
            // Mesclar dados (manter estrutura existente)
            const dadosMesclados = {
                ...dadosExistentes,
                ...dadosExportados.aprendizadoScript,
                lastUpdated: obterTimestampBrasil()
            };
            
            if (salvarArquivoJSON(APRENDIZADO_SCRIPT_FILE, dadosMesclados)) {
                resultados.aprendizadoScript = {
                    sucesso: true,
                    atualizado: true
                };
                console.log('✅ Aprendizado do script atualizado');
            }
        }
        
        // 4. Mostrar resumo
        console.log('📊 Resumo da importação:');
        console.log(`- Modelos de respostas: ${resultados.modelosRespostas.sucesso ? '✅' : '❌'} (${resultados.modelosRespostas.adicionados} novos, ${resultados.modelosRespostas.duplicados} duplicados)`);
        console.log(`- Aprendizado do script: ${resultados.aprendizadoScript.sucesso ? '✅' : '❌'}`);
        
        return resultados;
        
    } catch (error) {
        console.error('❌ Erro na importação:', error.message);
        return null;
    }
}

// Função principal
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('📋 Uso: node import-localstorage-data.js <arquivo-exportado.json>');
        console.log('💡 Exemplo: node import-localstorage-data.js velotax-bot-dados-2025-09-24.json');
        return;
    }
    
    const arquivoExportado = args[0];
    
    if (!fs.existsSync(arquivoExportado)) {
        console.error(`❌ Arquivo não encontrado: ${arquivoExportado}`);
        return;
    }
    
    const resultado = importarDadosDoLocalStorage(arquivoExportado);
    
    if (resultado) {
        console.log('🎉 Importação concluída com sucesso!');
    } else {
        console.log('❌ Importação falhou');
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    main();
}

module.exports = { importarDadosDoLocalStorage };
