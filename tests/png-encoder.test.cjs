const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Worker } = require('node:worker_threads');
const ts = require('typescript');
const UPNG = require('upng-js');

function compile(path) {
    return ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
}

function evaluate(source, imports) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', source)(name => {
        assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
        return imports[name];
    }, module, module.exports);
    return module.exports;
}

function loadClient() {
    const workers = [];
    class FakeWorker {
        constructor() { workers.push(this); this.requests = []; }
        postMessage(request, transfer) { this.requests.push(structuredClone(request, { transfer })); }
        respond(request, response) { this.onmessage({ data: { id: request.id, ...response } }); }
        terminate() { this.terminated = true; }
    }
    const client = evaluate(compile('src/utils/pngEncoder.ts'), {
        './pngEncoder.worker?worker&inline': { default: FakeWorker },
    });
    return { client, workers };
}

test('worker transfers only the requested byte range and preserves caller-owned data', async () => {
    const { client, workers } = loadClient();
    const original = Uint8Array.from([9, 1, 2, 3, 9]);
    const encoding = client.optimizePNGData(original.subarray(1, 4));
    const request = workers[0].requests[0];
    assert.deepEqual([...new Uint8Array(request.buffer)], [1, 2, 3]);
    assert.deepEqual([...original], [9, 1, 2, 3, 9]);
    workers[0].respond(request, { buffer: Uint8Array.from([4, 5]).buffer });
    assert.deepEqual([...await encoding], [4, 5]);
});

test('concurrent worker responses resolve the matching requests', async () => {
    const { client, workers } = loadClient();
    const first = client.optimizePNGData(new ArrayBuffer(2));
    const second = client.optimizePNGData(new ArrayBuffer(3));
    const worker = workers[0];
    worker.respond(worker.requests[1], { buffer: Uint8Array.from([2]).buffer });
    worker.respond(worker.requests[0], { buffer: Uint8Array.from([1]).buffer });
    assert.deepEqual([...await first], [1]);
    assert.deepEqual([...await second], [2]);
});

test('worker crashes reject pending work and allow a fresh worker on retry', async () => {
    const { client, workers } = loadClient();
    const first = client.optimizePNGData(new ArrayBuffer(2));
    const second = client.optimizePNGData(new ArrayBuffer(3));
    const failures = Promise.all([assert.rejects(first, /crashed/), assert.rejects(second, /crashed/)]);
    workers[0].onerror({ message: 'crashed' });
    await failures;
    assert.equal(workers[0].terminated, true);
    const retry = client.optimizePNGData(new ArrayBuffer(2));
    assert.equal(workers.length, 2);
    workers[1].respond(workers[1].requests[0], { buffer: new ArrayBuffer(1) });
    await retry;
});

test('initialization accepts an empty acknowledgement; encoding rejects empty output', async () => {
    const { client, workers } = loadClient();
    const initialization = client.initOxipng();
    workers[0].respond(workers[0].requests[0], {});
    await initialization;
    const encoding = client.optimizePNGData(new ArrayBuffer(1));
    workers[0].respond(workers[0].requests[1], { buffer: new ArrayBuffer(0) });
    await assert.rejects(encoding, /returned no data/);
});

test('lossless compression failures keep the PNG without main-thread encoding', async context => {
    context.mock.method(console, 'warn', () => {});
    const utils = evaluate(compile('src/utils/index.ts'), {
        './webpEncoder.worker?worker&inline': {},
        './pngEncoder': { optimizePNGBlob: async () => { throw new Error('Worker unavailable'); } },
    });
    const input = new Blob(['original'], { type: 'image/png' });
    assert.equal(await utils.reencodeImageBlob(input, 'png', { pngMode: 'lossless' }), input);
});

test('real PNG worker preserves pixels and keeps the main-thread timer responsive', async context => {
    const modules = {
        './oxipng': compile('src/utils/oxipng.ts'),
        './oxipngWasm': compile('src/utils/oxipngWasm.ts'),
    };
    const workerSource = compile('src/utils/pngEncoder.worker.ts');
    let started = false;
    let heartbeats = 0;
    const interval = setInterval(() => { if (started) heartbeats++; }, 10);
    const nodeWorker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const cache = {};
        function load(name) {
            if (name === 'upng-js') return { default: require(workerData.upng) };
            if (cache[name]) return cache[name].exports;
            const module = cache[name] = { exports: {} };
            new Function('require', 'module', 'exports', workerData.modules[name])(load, module, module.exports);
            return module.exports;
        }
        global.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
        new Function('require', workerData.source)(load);
        parentPort.on('message', data => {
            parentPort.postMessage({ testEvent: 'started' });
            self.onmessage({ data });
        });
    `, { eval: true, workerData: { modules, source: workerSource, upng: require.resolve('upng-js') } });
    const responses = new Map();
    nodeWorker.on('message', data => {
        if (data.testEvent) { started = true; return; }
        const pending = responses.get(data.id);
        responses.delete(data.id);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.buffer);
    });
    nodeWorker.on('error', error => { for (const pending of responses.values()) pending.reject(error); });
    const request = data => new Promise((resolve, reject) => {
        responses.set(data.id, { resolve, reject });
        nodeWorker.postMessage(data, [data.buffer]);
    });
    try {
        const width = 1024, height = 768;
        const pixels = new Uint8Array(width * height * 4);
        let seed = 42;
        for (let i = 0; i < pixels.length; i += 4) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            pixels[i] = seed >>> 24;
            pixels[i + 1] = (i / 4) % width;
            pixels[i + 2] = Math.floor(i / 4 / width) % 256;
            pixels[i + 3] = 255;
        }
        const input = UPNG.encode([pixels.buffer], width, height, 0);
        const begin = performance.now();
        const result = await request({ id: 1, type: 'optimize', buffer: input, options: { level: 2, optimiseAlpha: true } });
        const elapsed = performance.now() - begin;
        const decoded = UPNG.decode(result);
        assert.equal(decoded.width, width);
        assert.equal(decoded.height, height);
        assert.deepEqual(new Uint8Array(UPNG.toRGBA8(decoded)[0]), pixels);
        assert.ok(heartbeats > 0, 'The timer must fire while the worker is processing');
        context.diagnostic(`1024×768 lossless PNG: ${elapsed.toFixed(0)} ms; 10 ms timer fired ${heartbeats} times during worker processing`);
        const smallPixels = new Uint8Array(32 * 24 * 4).fill(255);
        const quantized = await request({ id: 2, type: 'quantize', buffer: smallPixels.buffer, width: 32, height: 24, quality: 0.92 });
        assert.equal(UPNG.decode(quantized).width, 32);
        assert.equal(UPNG.decode(quantized).height, 24);
    } finally {
        clearInterval(interval);
        await nodeWorker.terminate();
    }
});
