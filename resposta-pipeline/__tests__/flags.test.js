'use strict';

const assert = require('assert');
const { getPipelineMode, isShadowEnabled, isPevPlanExecEnabled, isPevFactualAuditorEnabled, isPevEditorialAuditorEnabled, isPevConditionalAuditEnabled, isPevConditionalAuditShadow, isPevSkipFactualTier1Enabled, isPevChanceModeracaoEnabled, isPevRaStandardEnabled } = require('../index');
const { PIPELINE_MODE } = require('../constants');

assert.strictEqual(getPipelineMode({}), PIPELINE_MODE.OFF);
assert.strictEqual(getPipelineMode({ RESPOSTA_PIPELINE_MODE: 'shadow' }), PIPELINE_MODE.SHADOW);
assert.strictEqual(getPipelineMode({ RESPOSTA_PIPELINE_MODE: 'pev' }), PIPELINE_MODE.PEV);

assert.strictEqual(isShadowEnabled(PIPELINE_MODE.SHADOW), true);
assert.strictEqual(isShadowEnabled(PIPELINE_MODE.PEV), false);

assert.strictEqual(isPevPlanExecEnabled({}), false);
assert.strictEqual(isPevPlanExecEnabled({ PEV_PLAN_EXEC_ENABLED: 'false' }), false);
assert.strictEqual(isPevPlanExecEnabled({ PEV_PLAN_EXEC_ENABLED: 'true' }), true);

assert.strictEqual(isPevFactualAuditorEnabled({}), false);
assert.strictEqual(isPevFactualAuditorEnabled({ PEV_FACTUAL_AUDITOR_ENABLED: 'false' }), false);
assert.strictEqual(isPevFactualAuditorEnabled({ PEV_FACTUAL_AUDITOR_ENABLED: 'true' }), true);

assert.strictEqual(isPevEditorialAuditorEnabled({}), false);
assert.strictEqual(isPevEditorialAuditorEnabled({ PEV_EDITORIAL_AUDITOR_ENABLED: 'false' }), false);
assert.strictEqual(isPevEditorialAuditorEnabled({ PEV_EDITORIAL_AUDITOR_ENABLED: 'true' }), true);

assert.strictEqual(isPevConditionalAuditEnabled({}), false);
assert.strictEqual(isPevConditionalAuditEnabled({ PEV_CONDITIONAL_AUDIT_ENABLED: 'true' }), true);

assert.strictEqual(isPevConditionalAuditShadow({}), false);
assert.strictEqual(isPevConditionalAuditShadow({ PEV_CONDITIONAL_AUDIT_SHADOW: 'true' }), true);

assert.strictEqual(isPevSkipFactualTier1Enabled({}), false);
assert.strictEqual(isPevSkipFactualTier1Enabled({ PEV_SKIP_FACTUAL_TIER1_ENABLED: 'true' }), true);

assert.strictEqual(isPevChanceModeracaoEnabled({}), false);
assert.strictEqual(isPevChanceModeracaoEnabled({ PEV_CHANCE_MODERACAO_ENABLED: 'false' }), false);
assert.strictEqual(isPevChanceModeracaoEnabled({ PEV_CHANCE_MODERACAO_ENABLED: 'true' }), true);

assert.strictEqual(isPevRaStandardEnabled({}), true);
assert.strictEqual(isPevRaStandardEnabled({ PEV_RA_STANDARD_ENABLED: 'false' }), false);
assert.strictEqual(isPevRaStandardEnabled({ PEV_RA_STANDARD_ENABLED: 'true' }), true);

const { isPevObservabilityEnabled, isPevObservabilityExportsEnabled } = require('../observability');

assert.strictEqual(isPevObservabilityEnabled({}), false);
assert.strictEqual(isPevObservabilityEnabled({ PEV_OBSERVABILITY_ENABLED: 'true' }), true);
assert.strictEqual(isPevObservabilityExportsEnabled({}), false);
assert.strictEqual(isPevObservabilityExportsEnabled({ PEV_OBSERVABILITY_EXPORTS: 'true' }), true);

console.log('resposta-pipeline/__tests__/flags.test.js — OK');
