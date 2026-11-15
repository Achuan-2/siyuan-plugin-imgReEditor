const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');

test('fast WebP saving reduces encoding effort while retaining quality and exact lossless options', async () => {
    const configurations = [], responses = [];
    const scope = { postMessage: message => responses.push(message) };
    const moduleSource = ts.transpileModule(readFileSync(resolve(__dirname, '../src/utils/webpEncoder.worker.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    new Function('require', 'self', 'exports', moduleSource)(name => {
        if (name === '@jsquash/webp/codec/enc/webp_enc.js' || name === '@jsquash/webp/codec/enc/webp_enc_simd.js') return { default: async () => ({
            encode(pixels, width, height, options) {
                assert.equal(pixels.length, width * height * 4);
                configurations.push(options);
                return Uint8Array.from([1, 2, 3]);
            },
        }) };
        if (name === '@jsquash/webp/meta.js') return { defaultOptions: { method: 6 } };
        throw new Error(`Unexpected import: ${name}`);
    }, scope, {});
    for (const [id, effort, quality] of [[1, 'fast', 1], [2, 'balanced', 1], [3, undefined, 0.85]]) {
        await scope.onmessage({ data: { id, effort, quality, width: 1, height: 1, pixels: new ArrayBuffer(4) } });
    }
    assert.deepEqual(configurations.map(options => options.method), [1, 4, 4]);
    for (const options of configurations.slice(0, 2)) {
        assert.equal(options.lossless, 1);
        assert.equal(options.exact, 1);
        assert.equal(options.near_lossless, 100);
        assert.equal(options.alpha_quality, 100);
    }
    assert.deepEqual(configurations.slice(0, 2).map(options => options.quality), [50, 70]);
    assert.equal(configurations[2].quality, 85);
    assert.equal(configurations[2].lossless, 0);
    assert.deepEqual(responses.map(response => response.id), [1, 2, 3]);
    assert.ok(responses.every(response => response.buffer.byteLength > 0 && !response.error));
});

test('WebP workers initialize once, detect SIMD and fall back when SIMD initialization fails', async () => {
    const source = ts.transpileModule(readFileSync(resolve(__dirname, '../src/utils/webpEncoder.worker.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    for (const scenario of [
        { simd: true, fail: false, expected: ['simd'] },
        { simd: false, fail: false, expected: ['scalar'] },
        { simd: true, fail: true, expected: ['simd', 'scalar'] },
    ]) {
        const initializations = [], messages = [];
        const scope = { postMessage: message => messages.push(message) };
        new Function('require', 'self', 'exports', 'WebAssembly', 'console', source)(name => {
            if (name === '@jsquash/webp/meta.js') return { defaultOptions: {} };
            const kind = name.includes('_simd') ? 'simd' : 'scalar';
            return { default: async () => {
                initializations.push(kind);
                if (kind === 'simd' && scenario.fail) throw new Error('SIMD unavailable');
                return { encode: () => Uint8Array.from([1, 2, 3]) };
            } };
        }, scope, {}, { validate: () => scenario.simd }, { warn() {} });
        for (const id of [1, 2]) await scope.onmessage({ data: {
            id, pixels: new ArrayBuffer(4), width: 1, height: 1, quality: 1,
        } });
        assert.deepEqual(initializations, scenario.expected);
        assert.equal(messages.length, 2);
        assert.ok(messages.every(message => message.buffer && !message.error));
    }
});
