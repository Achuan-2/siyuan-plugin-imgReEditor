const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { File } = require('node:buffer');
const ts = require('typescript');

// Transpile in memory so the tests exercise source without writing build artifacts.
function loadSource(path, imports = {}) {
    const source = ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', source)(
        name => {
            if (Object.hasOwn(imports, name)) return imports[name];
            throw new Error(`Unexpected import: ${name}`);
        }, module, module.exports
    );
    return module.exports;
}

const { observeAssetUploads } = loadSource('src/utils/assetUploadObserver.ts');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

class FakeXHR extends EventTarget {
    open(method, url) { this.method = method; this.url = url; }
    send(body) { this.sentBody = body; }
    finish(data, status = 200) {
        this.status = status;
        this.responseText = JSON.stringify(data);
        this.dispatchEvent(new Event('loadend'));
    }
}

function setBrowser(fetch = () => Promise.reject(new Error('Unexpected fetch'))) {
    global.XMLHttpRequest = FakeXHR;
    global.File = File;
    global.window = {
        fetch,
        location: { href: 'http://localhost:6806/', origin: 'http://localhost:6806' },
        setTimeout: (callback, ms) => setTimeout(callback, ms === 250 ? 5 : ms),
        getSelection: () => null,
    };
}

test('XHR uploads the original immediately and starts compression after editor completion', async () => {
    setBrowser();
    const compression = deferred();
    const events = [];
    const stop = observeAssetUploads(() => true, async (paths, docID) => {
        assert.deepEqual(paths, ['assets/a.png']);
        assert.equal(docID, 'doc');
        events.push('compression');
        await compression.promise;
        events.push('replacement');
    });
    try {
        const body = new FormData();
        body.append('id', 'doc');
        body.append('file[]', new File(['original'], 'a.png', { type: 'image/png' }));
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/asset/upload');
        xhr.send(body);
        assert.equal(xhr.sentBody, body);
        xhr.addEventListener('loadend', () => events.push('editor insertion'));
        xhr.finish({ code: 0, data: { succMap: { 'a.png': 'assets/a.png' } } });
        assert.deepEqual(events, ['editor insertion']);
        await delay(10);
        assert.deepEqual(events, ['editor insertion', 'compression']);
        compression.resolve();
        await delay(0);
        assert.equal(events.at(-1), 'replacement');
    } finally { stop(); }
});

test('fetch local uploads return the original Promise and readable response during compression', async () => {
    const response = Response.json({ code: 0, data: { succMap: { 'a.png': 'assets/a.png' } } });
    const upload = Promise.resolve(response);
    let sentInit;
    setBrowser((_input, init) => { sentInit = init; return upload; });
    const compression = deferred();
    let started = false;
    const stop = observeAssetUploads(() => true, async (_paths, docID) => {
        assert.equal(docID, 'doc');
        started = true;
        await compression.promise;
    });
    try {
        const init = { method: 'POST', body: JSON.stringify({ id: 'doc', assetPaths: ['C:/a.png'] }) };
        const result = window.fetch('/api/asset/insertLocalAssets', init);
        assert.equal(result, upload);
        assert.equal(sentInit, init);
        assert.deepEqual(await (await result).json(), { code: 0, data: { succMap: { 'a.png': 'assets/a.png' } } });
        await delay(20);
        assert.equal(started, true);
        compression.resolve();
    } finally { stop(); }
});

test('Request uploads preserve duplicate-name successes and ignore failed uploads and unload', async () => {
    setBrowser(() => Promise.resolve(Response.json({ code: 0, data: {
        succFiles: [{ path: 'assets/first.png' }, { path: 'assets/second.png' }, { path: 'assets/first.png' }],
        succMap: { 'image.png': 'assets/second.png' },
    } })));
    const calls = [];
    const stop = observeAssetUploads(() => true, async (...args) => { calls.push(args); });
    const request = new Request('http://localhost:6806/api/asset/insertLocalAssets', {
        method: 'POST', body: JSON.stringify({ id: 'doc', assetPaths: ['C:/first.png', 'C:/second.png'] }),
    });
    await window.fetch(request);
    await delay(20);
    assert.deepEqual(calls, [[['assets/first.png', 'assets/second.png'], 'doc', undefined]]);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/asset/upload');
    xhr.send(new FormData());
    xhr.finish({ code: -1, data: { succMap: { 'a.png': 'assets/a.png' } } });
    xhr.finish({ code: 0, data: {} }, 500);
    const pendingXHR = new XMLHttpRequest();
    pendingXHR.open('POST', '/api/asset/upload');
    pendingXHR.send(new FormData());
    pendingXHR.finish({ code: 0, data: { succMap: { 'a.png': 'assets/a.png' } } });
    stop();
    await delay(10);
    assert.equal(calls.length, 1);
});

class ImageBlock {
    constructor(path, text = 'text typed during compression', id = 'block') {
        this.id = id;
        this.text = text;
        this.image = {
            dataset: { src: path }, src: path,
            getAttribute(name) { return name === 'data-src' ? this.dataset.src : this.src; },
            setAttribute(name, value) { if (name === 'data-src') this.dataset.src = value; else this.src = value; },
            closest: () => this,
        };
    }
    getAttribute() { return this.id; }
    querySelectorAll() { return [this.image]; }
    cloneNode() { return new ImageBlock(this.image.dataset.src, this.text, this.id); }
    get outerHTML() { return `<div data-node-id="${this.id}">${this.text}<img data-src="${this.image.dataset.src}" src="${this.image.src}"></div>`; }
}

function createPlugin(api, utils = {}) {
    const Plugin = loadSource('src/index.ts', {
        siyuan: { Plugin: class {} }, '@/index.scss': {}, './Settings.svelte': {},
        './components/ImageEditor.svelte': {}, './defaultSettings': {}, './utils/i18n': {},
        './ScreenshotManager': {}, './utils/assetUploadObserver': { observeAssetUploads },
        './utils/uuid': { generateId: () => 'unique-id' }, './utils': utils, './api': api,
    }).default;
    const plugin = new Plugin();
    plugin.settings = { enablePasteImageCompression: true };
    return plugin;
}

test('background queue waits for insertion and saves the new link with current text', async () => {
    setBrowser();
    const live = new ImageBlock('assets/a.png');
    global.document = { querySelectorAll: selector => selector.endsWith('img') ? [live.image] : [live] };
    let indexed = false;
    const compression = deferred();
    const savedBlocks = [];
    let compressionCount = 0;
    const plugin = createPlugin({
        sql: async () => indexed ? [{ block_id: 'block', path: 'assets/a.png' }] : [],
        getBlockDOM: async () => ({ dom: '<stale block>' }),
        updateBlock: async (_type, html) => { savedBlocks.push(html); return [{}]; },
        pushMsg: async () => {}, pushErrMsg: async () => {},
    });
    plugin.compressImageAsset = async () => {
        compressionCount += 1;
        await compression.promise;
        return { status: 'compressed', originalSize: 100, savedSize: 40, savedPath: 'assets/new.webp' };
    };
    const job = plugin.queueAutomaticImageCompression(['assets/a.png'], 'doc', () => true);
    await delay(10);
    assert.equal(compressionCount, 0);
    indexed = true;
    await delay(10);
    assert.equal(compressionCount, 1);
    live.text = 'new text after insertion';
    compression.resolve();
    await job;
    assert.equal(compressionCount, 1);
    assert.match(savedBlocks[0], /new text after insertion/);
    assert.match(savedBlocks[0], /assets\/new.webp/);
    assert.equal(live.image.dataset.src, 'assets/new.webp');
});

test('deleted/replaced images and failed saves leave the original live block untouched', async () => {
    setBrowser();
    const live = new ImageBlock('assets/other.png');
    global.document = { querySelectorAll: () => [live] };
    let saves = 0;
    const plugin = createPlugin({
        getBlockDOM: async () => ({ dom: '<stale block>' }),
        updateBlock: async () => { saves += 1; return null; },
    });
    assert.equal(await plugin.replaceAutomaticImageReferences('assets/a.png', 'assets/new.webp', ['block'], () => true), 0);
    assert.equal(saves, 0);
    live.image.dataset.src = 'assets/a.png';
    live.image.src = 'assets/a.png';
    await assert.rejects(plugin.replaceAutomaticImageReferences('assets/a.png', 'assets/new.webp', ['block'], () => true));
    assert.equal(live.image.dataset.src, 'assets/a.png');
});

test('repeated paste waits for the new image even when an old reference is already indexed', async () => {
    setBrowser();
    const old = new ImageBlock('assets/a.png');
    const images = [old.image];
    global.document = { querySelectorAll: () => images };
    const plugin = createPlugin({ sql: async () => [{ block_id: 'block', path: 'assets/a.png' }] });
    let found = false;
    const waiting = plugin.waitForAutomaticImageReferences('assets/a.png', 'doc', () => true,
        [{ image: old.image, path: 'assets/a.png', blockID: 'block' }]).then(ids => {
            found = true;
            return ids;
        });
    await delay(10);
    assert.equal(found, false);
    images.push(new ImageBlock('assets/a.png').image);
    assert.deepEqual(await waiting, ['block']);
});

test('a second paste of the same asset during compression gets its own reference update', async () => {
    setBrowser();
    const first = new ImageBlock('assets/a.png', 'first', 'first');
    const blocks = [first];
    global.document = { querySelectorAll: selector => selector.endsWith('img') ? blocks.map(block => block.image) : blocks };
    const compression = deferred();
    let compressionCount = 0;
    const plugin = createPlugin({
        sql: async () => blocks.map(block => ({ block_id: block.id, path: block.image.dataset.src })),
        getBlockDOM: async () => ({ dom: '' }), updateBlock: async () => [{}],
        pushMsg: async () => {}, pushErrMsg: async () => {},
    });
    plugin.compressImageAsset = async () => {
        const index = ++compressionCount;
        await compression.promise;
        return { status: 'compressed', originalSize: 100, savedSize: 40, savedPath: `assets/new-${index}.webp` };
    };
    const firstJob = plugin.queueAutomaticImageCompression(['assets/a.png'], 'doc', () => true);
    await delay(10);
    const secondJob = plugin.queueAutomaticImageCompression(['assets/a.png'], 'doc', () => true,
        [{ image: first.image, path: 'assets/a.png', blockID: 'first' }]);
    compression.resolve();
    await firstJob;
    await delay(10);
    assert.equal(compressionCount, 1);
    const second = new ImageBlock('assets/a.png', 'second', 'second');
    blocks.push(second);
    await secondJob;
    assert.equal(compressionCount, 2);
    assert.equal(first.image.dataset.src, 'assets/new-1.webp');
    assert.equal(second.image.dataset.src, 'assets/new-2.webp');
});

test('automatic compression writes a separate resource only when smaller and keeps the source', async () => {
    setBrowser();
    const source = new Blob(['original image bytes']);
    let output = new Blob(['small']);
    const writes = [];
    const plugin = createPlugin({
        getFileBlob: async path => path === 'data/assets/a.png' ? source :
            writes.find(write => write.path === path)?.file || null,
        putFile: async (path, _isDir, file) => { writes.push({ path, file }); },
        pushMsg: async () => {}, pushErrMsg: async () => {},
    }, {
        reencodeImageBlob: async () => output,
        getMimeByFormat: () => 'image/png', locatePNGtEXt: () => false,
        readWebPMetadata: () => null,
    });
    const result = await plugin.compressImageAsset('assets/a.png', undefined, { silent: true, createNewAsset: true });
    assert.equal(result.status, 'compressed');
    assert.equal(result.savedPath, 'assets/a-compressed-unique-id.png');
    assert.equal(writes.length, 1);
    assert.notEqual(writes[0].path, 'data/assets/a.png');
    output = new Blob(['x'.repeat(100)]);
    const skipped = await plugin.compressImageAsset('assets/a.png', undefined, { silent: true, createNewAsset: true });
    assert.equal(skipped.reason, 'not-smaller');
    assert.equal(writes.length, 1);
});
