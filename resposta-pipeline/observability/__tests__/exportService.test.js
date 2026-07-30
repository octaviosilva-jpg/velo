'use strict';

const assert = require('assert');
const fs = require('fs');
const { exportJson, exportCsv, exportMarkdown } = require('../exportService');

const j = exportJson({ periodo: '30d' });
assert.ok(j.exportId);
assert.ok(fs.existsSync(j.path));

const c = exportCsv({ periodo: '30d' });
assert.ok(c.content.includes('periodo'));

const m = exportMarkdown({ periodo: '30d' });
assert.ok(m.content.includes('# Relatório Observabilidade PEV'));

console.log('observability/__tests__/exportService.test.js — OK');
