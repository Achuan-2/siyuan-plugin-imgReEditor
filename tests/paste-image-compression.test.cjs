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
const compressionSettings = loadSource('src/defaultSettings.ts');
const assetImageRefresh = loadSource('src/utils/assetImageRefresh.ts');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

function setBrowser(fetch = () => Promise.reject(new Error('Unexpected fetch'))) {
    global.File = File;
    global.window = {
        fetch,
        location: { href: 'http://localhost:6806/', origin: 'http://localhost:6806' },
        setTimeout: (callback, ms) => setTimeout(callback, ms === 250 ? 5 : ms),
        getSelection: () => null,
    };
}

class EventBus {
    listeners = new Map();
    on(type, listener) { this.listeners.set(type, listener); }
    off(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }
    emit(type, detail) { return this.listeners.get(type)?.({ detail }); }
}

function uploadEvent(bus, overrides = {}) {
    let complete;
    const detail = {
        protyle: { block: { rootID: 'doc' } }, target: 'editor',
        signal: new AbortController().signal,
        onComplete(callback) { complete = callback; },
        respondWith() { assert.fail('Background compression must not delay uploads'); },
        ...overrides,
    };
    assert.equal(bus.emit('before-upload-assets', detail), undefined);
    return complete;
}

test('host upload completion returns immediately and compresses with the original document and snapshot', async () => {
    setBrowser();
    const bus = new EventBus();
    const compression = deferred();
    const events = [];
    const context = [{ image: 'previous image' }];
    const stop = observeAssetUploads(bus, () => true, async (paths, docID, snapshot) => {
        assert.deepEqual(paths, ['assets/a.png']);
        assert.equal(docID, 'doc');
        assert.equal(snapshot, context);
        events.push('compression');
        await compression.promise;
        events.push('replacement');
    }, () => context, () => null);
    try {
        const protyle = { block: { rootID: 'doc' } };
        const complete = uploadEvent(bus, { protyle });
        assert.equal(typeof complete, 'function', 'onComplete must register synchronously');
        protyle.block.rootID = 'different-doc';
        assert.equal(complete({ status: 'success', succMap: { 'a.png': 'assets/a.png' } }), undefined);
        events.push('editor insertion');
        assert.deepEqual(events, ['editor insertion']);
        await delay(10);
        assert.deepEqual(events, ['editor insertion', 'compression']);
        compression.resolve();
        await delay(0);
        assert.equal(events.at(-1), 'replacement');
    } finally { stop(); }
});

test('partial uploads preserve duplicate-name successes and ignore unsuccessful results and abort', async () => {
    setBrowser();
    const bus = new EventBus();
    const calls = [];
    const stop = observeAssetUploads(bus, () => true, async (...args) => { calls.push(args); }, () => 'snapshot', () => null);
    try {
        uploadEvent(bus)({ status: 'partial',
            succFiles: [{ path: 'assets/first.png' }, { path: 'assets/second.png' }, { path: 'assets/first.png' }],
            succMap: { 'image.png': 'assets/second.png' },
        });
        for (const status of ['failed', 'canceled']) {
            uploadEvent(bus)({ status, succMap: { 'a.png': 'assets/a.png' } });
        }
        uploadEvent(bus)({ status: 'success', succFiles: [], succMap: { 'a.png': 'assets/a.png' } });
        const controller = new AbortController();
        const aborted = uploadEvent(bus, { signal: controller.signal });
        controller.abort();
        aborted({ status: 'success', succMap: { 'a.png': 'assets/a.png' } });
        await delay(10);
        assert.deepEqual(calls, [[['assets/first.png', 'assets/second.png'], 'doc', 'snapshot']]);
    } finally { stop(); }
});

test('disabled compression, missing documents and non-editor uploads do not register completion work', () => {
    const bus = new EventBus();
    let enabled = false;
    const stop = observeAssetUploads(bus, () => enabled, async () => assert.fail(), () => undefined, () => null);
    try {
        assert.equal(uploadEvent(bus), undefined);
        enabled = true;
        assert.equal(uploadEvent(bus, { protyle: undefined }), undefined);
        assert.equal(uploadEvent(bus, { target: 'av-cell' }), undefined);
        assert.equal(uploadEvent(bus, { target: 'background' }), undefined);
    } finally { stop(); }
});

test('turning compression off or unloading cancels pending and future completion work', async () => {
    const bus = new EventBus();
    let enabled = true;
    const stop = observeAssetUploads(bus, () => enabled, async () => assert.fail(), () => undefined, () => null);
    const first = uploadEvent(bus);
    first({ status: 'success', succMap: { a: 'assets/a.png' } });
    enabled = false;
    await delay(10);
    enabled = true;
    const second = uploadEvent(bus);
    const third = uploadEvent(bus);
    second({ status: 'success', succMap: { b: 'assets/b.png' } });
    stop();
    third({ status: 'success', succMap: { c: 'assets/c.png' } });
    await delay(10);
    assert.equal(bus.listeners.size, 0);
});

class ImageBlock {
    constructor(path, text = 'text typed during compression', id = 'block') {
        this.id = id;
        this.text = text;
        this.image = {
            tagName: 'IMG',
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
        './components/ImageEditor.svelte': {}, './defaultSettings': compressionSettings, './utils/i18n': { t: key => key },
        './ScreenshotManager': {}, './utils/assetUploadObserver': { observeAssetUploads },
        './utils/assetImageRefresh': assetImageRefresh,
        './utils': utils, './api': api,
        './utils/imageCompressionProgress': { showImageCompressionProgress: () => ({ update() {}, close() {} }) },
    }).default;
    const plugin = new Plugin();
    plugin.settings = { enablePasteImageCompression: true, convertToWebP: false };
    return plugin;
}

// Model both the document lookup and keyset pagination of the global asset index.
function referenceSQL(getReferences) {
    return async stmt => {
        const rows = getReferences().map((row, index) => ({ id: String(index + 1).padStart(6, '0'), ...row }));
        const cursor = stmt.match(/AND id > '([^']*)'/)?.[1];
        return cursor === undefined ? rows : rows.filter(row => row.id > cursor).slice(0, 256);
    };
}

test('compression format defaults to WebP and migrates the legacy switch without overriding a saved format', async () => {
    const plugin = createPlugin({});
    for (const [stored, expected] of [
        [null, 'webp'], [{}, 'webp'], [{ convertToWebP: false }, 'original'],
        [{ convertToWebP: true }, 'webp'], [{ compressionFormat: 'png', convertToWebP: true }, 'png'],
        [{ compressionFormat: 'jpeg' }, 'jpeg'], [{ compressionFormat: 'original' }, 'original'],
        [{ compressionFormat: 'invalid' }, 'webp'],
    ]) {
        plugin.loadData = async () => stored;
        const settings = await plugin.loadSettings();
        assert.equal(settings.compressionFormat, expected);
        assert.equal(settings.pngQuality, 92);
    }
});

test('automatic compression follows the selected global format and its quality for every source format', async () => {
    const source = new Blob(['source']);
    const plugin = createPlugin({ getFileBlob: async path => /^data\/assets\/a\.(png|jpg|webp)$/.test(path) ? source : null });
    const encoded = [];
    plugin.compressImageBlob = async (_source, input, output, options) => {
        encoded.push({ input, output, options });
        return new Blob(['small']);
    };
    for (const compressionFormat of ['png', 'jpeg', 'webp', 'original']) {
        plugin.settings = { compressionFormat, pngCompressionMode: 'lossy', pngQuality: 70, jpegQuality: 80, webpQuality: 90 };
        for (const [extension, input] of [['png', 'png'], ['jpg', 'jpeg'], ['webp', 'webp']]) {
            await plugin.prepareImageCompression(`assets/a.${extension}`);
            const output = compressionFormat === 'original' ? input : compressionFormat;
            const actual = encoded.at(-1);
            assert.equal(actual.output, output);
            assert.equal(actual.options.quality, { png: 0.7, jpeg: 0.8, webp: 0.9 }[output]);
            if (output === 'png') assert.equal(actual.options.pngMode, 'lossy');
        }
    }
});

test('background queue waits for insertion and saves the new link with current text', async () => {
    setBrowser();
    const live = new ImageBlock('assets/a.png');
    global.document = { querySelectorAll: selector => selector.endsWith('img') ? [live.image] : [live] };
    let indexed = false;
    const compression = deferred();
    const savedBlocks = [];
    let compressionCount = 0;
    const plugin = createPlugin({
        sql: referenceSQL(() => indexed ? [{ block_id: 'block', path: 'assets/a.png' }] : []),
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
    global.document = { querySelectorAll: selector => selector.endsWith('img') ? [live.image] : [live] };
    let saves = 0;
    const plugin = createPlugin({
        sql: referenceSQL(() => [{ block_id: 'block', path: 'assets/a.png' }]),
        getBlockDOM: async () => ({ dom: '<stale block>' }),
        updateBlock: async () => { saves += 1; return null; },
    });
    assert.equal(await plugin.replaceImageAssetReferencesEverywhere('assets/a.png', 'assets/new.webp'), 0);
    assert.equal(saves, 0);
    live.image.dataset.src = 'assets/a.png';
    live.image.src = 'assets/a.png';
    await assert.rejects(plugin.replaceImageAssetReferencesEverywhere('assets/a.png', 'assets/new.webp'));
    assert.equal(live.image.dataset.src, 'assets/a.png');
});

test('global conversion reads every index page, matches decoded full paths and deduplicates blocks', async () => {
    setBrowser();
    global.document = { querySelectorAll: () => [] };
    const original = "assets/测试图 '1.png";
    const saved = "assets/测试图 '1.webp";
    const rows = Array.from({ length: 300 }, (_, index) => ({
        block_id: `block-${index}`, path: index % 2 ? encodeURI(original) + '?width=300#preview' : original,
    }));
    rows.push(rows[0], { block_id: 'other-directory', path: "assets/other/测试图 '1.png" },
        { block_id: 'other-file', path: original + '.bak' });
    const queries = [];
    const query = referenceSQL(() => rows);
    const plugin = createPlugin({ sql: async stmt => { queries.push(stmt); return query(stmt); } });
    const updates = [];
    plugin.replaceImageAssetReferenceInBlock = async (id, before, after) => {
        assert.equal(before, original);
        assert.equal(after, saved);
        updates.push(id);
        return true;
    };
    assert.equal(await plugin.replaceImageAssetReferencesEverywhere(original, saved), 300);
    assert.equal(new Set(updates).size, 300);
    assert.ok(!updates.includes('other-directory') && !updates.includes('other-file'));
    assert.equal(queries.length, 3);
    assert.ok(queries.every(stmt => !stmt.includes('root_id') && stmt.includes("''1.png")));
});

test('global conversion updates live references in other documents and preserves URL suffixes and text', async () => {
    setBrowser();
    const first = new ImageBlock('assets/a.png', 'new text', 'first');
    const second = new ImageBlock('assets/a.png?width=300#preview', 'another document', 'second');
    const untouched = new ImageBlock('assets/other.png', 'unrelated', 'untouched');
    const blocks = [first, second, untouched];
    global.document = { querySelectorAll: selector => selector.endsWith('img') ? blocks.map(b => b.image) : blocks };
    const writes = [];
    const plugin = createPlugin({
        sql: referenceSQL(() => [{ block_id: 'first', path: 'assets/a.png' }]),
        updateBlock: async (_type, html, id) => { writes.push({ html, id }); return [{}]; },
    });
    assert.equal(await plugin.replaceImageAssetReferencesEverywhere('assets/a.png', 'assets/a.webp', first), 2);
    assert.deepEqual(writes.map(write => write.id), ['first', 'second']);
    assert.match(writes[0].html, /new text/);
    assert.match(writes[1].html, /another document/);
    assert.equal(second.image.dataset.src, 'assets/a.webp?width=300#preview');
    assert.equal(untouched.image.dataset.src, 'assets/other.png');
});

test('global reference lookup failures and cancellation never write blocks or delete resources', async () => {
    setBrowser();
    global.document = { querySelectorAll: () => [] };
    const plugin = createPlugin({ sql: async () => null });
    plugin.replaceImageAssetReferenceInBlock = async () => assert.fail('No blocks should be written');
    await assert.rejects(plugin.replaceImageAssetReferencesEverywhere('assets/a.png', 'assets/a.webp'), /Unable to load/);
    assert.equal(await plugin.replaceImageAssetReferencesEverywhere('assets/a.png', 'assets/a.webp', undefined, () => false), 0);
});

test('cancellation while reading a closed block prevents its pending reference update', async () => {
    setBrowser();
    global.document = { querySelectorAll: () => [] };
    const read = deferred();
    let active = true;
    const plugin = createPlugin({
        getBlockDOM: async () => { await read.promise; return { dom: '<closed block>' }; },
        updateBlock: async () => assert.fail('Cancelled compression must not write the block'),
    });
    const update = plugin.replaceImageAssetReferenceInBlock('block', 'assets/a.png', 'assets/a.webp', undefined, () => active);
    await delay(0);
    active = false;
    read.resolve();
    assert.equal(await update, false);
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
        sql: referenceSQL(() => blocks.map(block => ({ block_id: block.id, path: block.image.dataset.src }))),
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

test('same-format automatic compression keeps the complete filename and only writes smaller results', async () => {
    setBrowser();
    let source = new Blob(['original image bytes']);
    let output = new Blob(['small']);
    const writes = [];
    const plugin = createPlugin({
        getFileBlob: async path => path === 'data/assets/a.png' ? source : null,
        putFile: async (path, _isDir, file) => { writes.push({ path, file }); source = file; },
        pushMsg: async () => {}, pushErrMsg: async () => {},
    }, {
        reencodeImageBlob: async (_blob, format) => { assert.equal(format, 'png'); return output; },
        getMimeByFormat: () => 'image/png', locatePNGtEXt: () => false,
        readWebPMetadata: () => null,
    });
    global.document = { querySelectorAll: () => [] };
    const result = await plugin.compressImageAsset('assets/a.png', undefined, { silent: true });
    assert.equal(result.status, 'compressed');
    assert.equal(result.savedPath, 'assets/a.png');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, 'data/assets/a.png');
    assert.equal(writes[0].file.name, 'a.png');
    output = new Blob(['x'.repeat(100)]);
    const skipped = await plugin.compressImageAsset('assets/a.png', undefined, { silent: true });
    assert.equal(skipped.reason, 'not-smaller');
    assert.equal(writes.length, 1);
});

test('single-image pixel overrides reach the encoder without changing global settings', async () => {
    setBrowser();
    global.document = { querySelectorAll: () => [] };
    let stored = new Blob(['original image bytes']);
    const limits = [];
    const plugin = createPlugin({
        getFileBlob: async () => stored,
        putFile: async (_path, _isDir, file) => { stored = file; },
        pushMsg: async () => {}, pushErrMsg: async () => {},
    }, {
        reencodeImageBlob: async (_blob, _format, options) => {
            limits.push(options.maxLongEdge);
            return new Blob([new Uint8Array(stored.size - 1)]);
        },
        getMimeByFormat: () => 'image/png', locatePNGtEXt: () => false,
    });
    plugin.settings = { limitImageLongEdge: true, imageMaxLongEdge: 2000, compressionFormat: 'original' };
    assert.equal((await plugin.compressImageAsset('assets/a.png', undefined, { silent: true, maxLongEdge: 1200 })).status, 'compressed');
    assert.equal((await plugin.compressImageAsset('assets/a.png', undefined, { silent: true, maxLongEdge: undefined })).status, 'compressed');
    assert.deepEqual(limits, [1200, undefined]);
    assert.deepEqual(plugin.settings, { limitImageLongEdge: true, imageMaxLongEdge: 2000, compressionFormat: 'original' });
});

test('document compression shares the chosen pixel limit across unique images', async () => {
    const plugin = createPlugin({ pushMsg: async () => {}, pushErrMsg: async () => {} });
    const calls = [];
    plugin.compressImageAsset = async (path, _image, options) => {
        calls.push([path, options.maxLongEdge]);
        return { status: 'skipped', reason: 'not-smaller' };
    };
    await plugin.compressDocumentImageAssets('doc', ['assets/a.png', 'assets/b.jpg', 'assets/a.png'], { maxLongEdge: 1800 });
    assert.deepEqual(calls, [['assets/a.png', 1800], ['assets/b.jpg', 1800]]);
});

test('manual format and quality overrides preserve global defaults and resolve mixed formats independently', async () => {
    setBrowser();
    const source = new Blob(['source image']);
    const plugin = createPlugin({ getFileBlob: async path => /^data\/assets\/[ab]\.(png|jpg)$/.test(path) ? source : null });
    plugin.settings = { convertToWebP: true, pngCompressionMode: 'lossless', pngQuality: 92, jpegQuality: 85 };
    const settings = { ...plugin.settings };
    const encoded = [];
    plugin.compressImageBlob = async (_source, input, output, options) => {
        encoded.push({ input, output, options });
        return new Blob(['compressed']);
    };
    await plugin.prepareImageCompression('assets/a.png', { outputFormat: 'jpeg', quality: 0.6 });
    await plugin.prepareImageCompression('assets/b.jpg', {
        outputFormat: 'original', formatOptions: { png: { quality: 0.5, pngMode: 'lossy' }, jpeg: { quality: 0.85 } },
    });
    assert.equal(encoded[0].output, 'jpeg');
    assert.equal(encoded[0].options.quality, 0.6);
    assert.equal(encoded[1].output, 'jpeg', 'Original format bypasses the global WebP conversion switch');
    assert.equal(encoded[1].options.quality, 0.85);
    assert.deepEqual(plugin.settings, settings);
});

test('automatic compression uses the global pixel switch and validates saved limits', async () => {
    const plugin = createPlugin({});
    plugin.waitForAutomaticImageReferences = async () => [{}];
    const limits = [];
    plugin.compressImageAsset = async (_path, _image, options) => {
        limits.push(options.maxLongEdge);
        return { status: 'skipped', reason: 'not-smaller' };
    };
    for (const [enabled, value] of [[true, 2000], [false, 1200], [true, 1200], [true, -5], [true, null]]) {
        plugin.settings = { limitImageLongEdge: enabled, imageMaxLongEdge: value };
        await plugin.queueAutomaticImageCompression(['assets/a.png'], 'doc', () => true);
    }
    assert.deepEqual(limits, [2000, undefined, 1200, 2000, 2000]);
});

test('WebP conversion preserves an existing target and chooses a separate filename', async () => {
    setBrowser();
    const source = new Blob(['original image bytes']);
    let target = new Blob(['previous WebP bytes']);
    const writes = [];
    const files = new Map([
        ['data/assets/测试图片-20261001000000-abcdefg.PNG', source],
        ['data/assets/测试图片-20261001000000-abcdefg.webp', target],
    ]);
    const plugin = createPlugin({
        getFileBlob: async path => files.get(path) || null,
        putFile: async (path, _isDir, file) => { writes.push({ path, file }); files.set(path, file); },
        pushMsg: async () => {}, pushErrMsg: async () => {},
    }, {
        reencodeImageBlob: async (_blob, format) => { assert.equal(format, 'webp'); return new Blob(['small']); },
        getMimeByFormat: () => 'image/webp', locatePNGtEXt: () => false,
    });
    plugin.settings.convertToWebP = true;
    const result = await plugin.compressImageAsset('assets/测试图片-20261001000000-abcdefg.PNG', undefined, { silent: true });
    assert.equal(result.status, 'compressed');
    assert.equal(result.savedPath, 'assets/测试图片-20261001000000-abcdefg-1.webp');
    assert.equal(files.get('data/assets/测试图片-20261001000000-abcdefg.webp'), target);
    assert.equal(files.get('data/assets/测试图片-20261001000000-abcdefg.PNG'), source);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `data/${result.savedPath}`);
    assert.equal(writes[0].file.name, '测试图片-20261001000000-abcdefg-1.webp');
});

test('same-path background compression does not rewrite blocks or delete the asset', async () => {
    setBrowser();
    const live = new ImageBlock('assets/a.png');
    global.document = { querySelectorAll: selector => selector.endsWith('img') ? [live.image] : [live] };
    const messages = [];
    const plugin = createPlugin({
        sql: async () => [{ block_id: 'block', path: 'assets/a.png' }],
        updateBlock: async () => { assert.fail('Same-path compression must not save the block'); },
        pushMsg: async message => { messages.push(message); }, pushErrMsg: async () => {},
    });
    plugin.compressImageAsset = async (_path, _image, options) => {
        assert.equal(options.createNewAsset, undefined);
        return { status: 'compressed', originalSize: 100, savedSize: 40, savedPath: 'assets/a.png' };
    };
    await plugin.queueAutomaticImageCompression(['assets/a.png'], 'doc', () => true);
    assert.equal(live.image.dataset.src, 'assets/a.png');
    assert.equal(messages.length, 1);
});

test('failed same-path write verification restores the source without refreshing the image', async () => {
    setBrowser();
    const source = new Blob(['original image bytes']);
    let stored = source;
    const writes = [];
    global.document = { querySelectorAll: () => { assert.fail('Failed writes must not refresh images'); } };
    const plugin = createPlugin({
        getFileBlob: async () => stored,
        putFile: async (_path, _isDir, file) => {
            writes.push(file);
            stored = writes.length === 1 ? new Blob(['corrupted']) : file;
        },
        pushMsg: async () => {}, pushErrMsg: async () => {},
    }, {
        reencodeImageBlob: async () => new Blob(['small']),
        getMimeByFormat: () => 'image/png', locatePNGtEXt: () => false,
    });
    const result = await plugin.compressImageAsset('assets/a.png', undefined, { silent: true });
    assert.equal(result.reason, 'write-failed');
    assert.equal(writes.length, 2);
    assert.equal(await stored.text(), await source.text());
});

test('single-image compression and editor saves update references without starting global asset cleanup', async () => {
    setBrowser();
    const items = new Map();
    window.siyuan = { menus: { menu: { addItem: item => items.set(item.id, item) } } };
    const live = new ImageBlock('assets/a.png');
    let cleanupCalls = 0;
    const references = [];
    const plugin = createPlugin({
        getFileBlob: async () => null,
        request: async () => { cleanupCalls++; return null; },
        pushErrMsg: async () => assert.fail('Reference updates should succeed'),
    });
    plugin.showImageCompressionDialog = async (_title, _paths, confirm) => confirm({ outputFormat: 'webp' });
    plugin.compressImageAsset = async () => ({
        status: 'compressed', originalPath: 'assets/a.png', savedPath: 'assets/a.webp', originalSize: 100, savedSize: 40,
    });
    plugin.replaceImageAssetReferencesEverywhere = async (...args) => {
        assert.equal(args[2], live, 'Use the block belonging to the clicked image');
        references.push(['global', ...args.slice(0, 2)]);
    };
    plugin.replaceImageAssetReferenceInBlock = async (...args) => references.push(args.slice(0, 3));
    await plugin.openMenuImageHandler({ detail: { element: { querySelector: () => live.image, closest: () => live } } });
    await items.get('compress-image').click();
    let onSave;
    plugin.openImageEditorDialog = (...args) => { onSave = args[4]; };
    await items.get('edit-image').click();
    await onSave('assets/edited.webp');
    assert.deepEqual(references, [
        ['global', 'assets/a.png', 'assets/a.webp'], ['block', 'assets/a.png', 'assets/edited.webp'],
    ]);
    assert.equal(cleanupCalls, 0, 'Continue editing without triggering the kernel cleanup race');
});

test('document conversion saves every reference without per-image cleanup requests', async () => {
    setBrowser();
    let cleanupCalls = 0;
    const references = [];
    const plugin = createPlugin({
        request: async () => { cleanupCalls++; return null; },
        pushMsg: async () => {}, pushErrMsg: async () => assert.fail('Document conversion should succeed'),
    });
    plugin.compressImageAsset = async path => ({
        status: 'compressed', originalPath: path, savedPath: path.replace(/\.png$/, '.webp'), originalSize: 100, savedSize: 40,
    });
    plugin.replaceImageAssetReferencesEverywhere = async (...args) => references.push(args);
    await plugin.compressDocumentImageAssets('doc', ['assets/a.png', 'assets/b.png'], { outputFormat: 'webp' });
    assert.deepEqual(references, [['assets/a.png', 'assets/a.webp'], ['assets/b.png', 'assets/b.webp']]);
    assert.equal(cleanupCalls, 0);
});

test('a paste removed during compression leaves the unused output for explicit SiYuan cleanup', async () => {
    setBrowser();
    let cleanupCalls = 0;
    const plugin = createPlugin({
        request: async () => { cleanupCalls++; return null; },
        pushMsg: async () => assert.fail('Removed images must not be reported as compressed'), pushErrMsg: async () => assert.fail(),
    });
    plugin.waitForAutomaticImageReferences = async () => ['block'];
    plugin.getAutomaticImageReferenceBlocks = async () => [];
    plugin.replaceImageAssetReferencesEverywhere = async () => 0;
    plugin.compressImageAsset = async () => ({
        status: 'compressed', originalPath: 'assets/a.png', savedPath: 'assets/a.webp', originalSize: 100, savedSize: 40,
    });
    await plugin.queueAutomaticImageCompression(['assets/a.png'], 'doc', () => true);
    assert.equal(cleanupCalls, 0);
});
