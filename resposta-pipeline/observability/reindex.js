'use strict';

const { reindexAll } = require('./indexer');

async function main() {
    const force = process.argv.includes('--force');
    console.log(`[observability/reindex] iniciando (force=${force})...`);
    const result = reindexAll({ force });
    console.log(`[observability/reindex] indexados=${result.indexed}/${result.total} erros=${result.errors.length}`);
    if (result.errors.length) {
        for (const e of result.errors) {
            console.error(`  - ${e.executionId}: ${e.error}`);
        }
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
