'use strict';

const { runChanceModeracaoPipeline } = require('./runner');

module.exports = {
    runChanceModeracaoPipeline,
    runner: require('./runner'),
    extrator: require('./extrator'),
    auditora: require('./auditora'),
    reformulador: require('./reformulador'),
    comparador: require('./comparador'),
    montarResultadoFinal: require('./montarResultadoFinal'),
    constants: require('./constants'),
    secoesV8: require('./secoesV8'),
    contratoChamadasOpenAI: require('./contratoChamadasOpenAI'),
    contratosEtapa: require('./contratosEtapa')
};
