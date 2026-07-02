// Carregador de Perfil de Calibracao (versionado).
// O Motor e o Perfil sao versionados de forma independente:
//  - MOTOR_VERSION vive no motor (logica/pipeline).
//  - perfil_calibracao_version vive no arquivo JSON (numeros).

const fs = require('fs');
const path = require('path');

const PERFIL_PADRAO = 'v1';
const cache = {};

function carregarPerfil(versao = PERFIL_PADRAO) {
    if (cache[versao]) return cache[versao];
    const arquivo = path.join(__dirname, `perfil_calibracao_${versao}.json`);
    const bruto = fs.readFileSync(arquivo, 'utf8');
    const perfil = JSON.parse(bruto);
    cache[versao] = perfil;
    return perfil;
}

module.exports = { carregarPerfil, PERFIL_PADRAO };
