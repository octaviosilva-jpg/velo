'use strict';

function percentile(sortedAsc, p) {
    if (!sortedAsc.length) return null;
    if (sortedAsc.length === 1) return sortedAsc[0];
    const idx = (p / 100) * (sortedAsc.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedAsc[lo];
    const w = idx - lo;
    return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

function computePercentiles(values, ps = [50, 95, 99]) {
    const nums = values.filter(v => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b);
    const result = {};
    for (const p of ps) {
        result[`p${p}`] = percentile(nums, p);
    }
    return result;
}

function mean(values) {
    const nums = values.filter(v => typeof v === 'number' && !Number.isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function incrementHistogram(hist, key) {
    if (!key) return hist;
    const k = String(key);
    hist[k] = (hist[k] || 0) + 1;
    return hist;
}

function mergeHistograms(a = {}, b = {}) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
        out[k] = (out[k] || 0) + v;
    }
    return out;
}

module.exports = {
    percentile,
    computePercentiles,
    mean,
    incrementHistogram,
    mergeHistograms
};
