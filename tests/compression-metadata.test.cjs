const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { File } = require('node:buffer');
const ts = require('typescript');
const UPNG = require('upng-js');

function compile(path) {
    return ts.transpileModule(readFileSync(resolve(__dirname, '..', path), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
}

function evaluate(source, imports) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'File', 'document', 'console', source)(name => {
        assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
        return imports[name];
    }, module, module.exports, File, { querySelectorAll: () => [] }, { warn() {}, error() {} });
    return module.exports;
}

const pluginSource = compile('src/index.ts');
const utils = evaluate(compile('src/utils/index.ts'), {
    './webpEncoder.worker?worker&inline': {}, './pngEncoder': {},
});
const key = 'siyuan-plugin-imgReEditor';
const png = new Uint8Array(UPNG.encode([new Uint8Array(32 * 24 * 4).fill(255).buffer], 32, 24, 0));
const webp = new Uint8Array(Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'));
const bareImages = { png, webp };
const insertMetadata = { png: utils.insertPNGTextChunk, webp: utils.insertWebPMetadata };
const readMetadata = { png: utils.readPNGTextChunk, webp: utils.readWebPMetadata };
const embedded = JSON.stringify({
    version: 1, isCanvasMode: true,
    canvasJSON: { objects: [{ type: 'Textbox', text: '仍可编辑的文本', fontSize: 24 }] },
});
const backupPointer = JSON.stringify({ version: 1, isCanvasMode: true, backupFileName: 'canvas.png.json' });

function createPlugin(api = {}, overrides = {}, notifications = []) {
    const Plugin = evaluate(pluginSource, {
        siyuan: { Plugin: class {}, showMessage: message => notifications.push(message) },
        '@/index.scss': {}, './Settings.svelte': {},
        './components/ImageEditor.svelte': {}, './defaultSettings': {},
        './utils/i18n': { t: key => key }, './ScreenshotManager': {},
        './utils/assetUploadObserver': {}, './api': api,
        './utils': {
            ...utils,
            // Strip all metadata like a pixel encoder would; use the real metadata helpers.
            reencodeImageBlob: async (_blob, format) => new Blob([bareImages[format]], {
                type: utils.getMimeByFormat(format),
            }),
            ...overrides,
        },
    }).default;
    const plugin = new Plugin();
    plugin.settings = {};
    plugin.loadData = async () => null;
    plugin.saveData = async () => {};
    return plugin;
}

for (const format of ['png', 'webp']) {
    for (const [mode, metadata] of [['embed', embedded], ['backup', backupPointer]]) {
        test(`${format} compression preserves the complete ${mode} metadata`, async () => {
            const source = new Blob([insertMetadata[format](bareImages[format], key, metadata)]);
            const output = await createPlugin().compressImageBlob(source, format, format);
            assert.equal(readMetadata[format](new Uint8Array(await output.arrayBuffer()), key), metadata);
        });
    }
}

test('PNG to WebP conversion verifies metadata in the output format', async () => {
    const source = new Blob([utils.insertPNGTextChunk(png, key, embedded)]);
    const output = await createPlugin().compressImageBlob(source, 'png', 'webp');
    assert.equal(utils.readWebPMetadata(new Uint8Array(await output.arrayBuffer()), key), embedded);
});

test('metadata overrides from sidecar data are also verified', async () => {
    const output = await createPlugin().compressImageBlob(new Blob(['jpeg']), 'jpeg', 'webp', {}, embedded);
    assert.equal(utils.readWebPMetadata(new Uint8Array(await output.arrayBuffer()), key), embedded);
});

for (const failure of ['read', 'insert', 'missing', 'changed']) {
    test(`batch compression never overwrites a file when metadata is ${failure}`, async () => {
        const protectedPath = 'data/assets/a.png';
        const ordinaryPath = 'data/assets/b.png';
        const source = new Blob([utils.insertPNGTextChunk(png, key, embedded), new Uint8Array(2048)]);
        const ordinary = new Blob([png, new Uint8Array(2048)]);
        const stored = new Map([[protectedPath, source], [ordinaryPath, ordinary]]);
        const writes = [];
        const progress = [];
        let history;
        const plugin = createPlugin({
            readDir: async () => [{ name: 'a.png' }, { name: 'b.png' }],
            getFileBlob: async path => stored.get(path),
            putFile: async (path, _isDir, file) => { writes.push(path); stored.set(path, file); },
        }, {
            readPNGTextChunk: (buffer, keyword) => {
                if (failure === 'read') throw new Error('Metadata read failed');
                return utils.readPNGTextChunk(buffer, keyword);
            },
            insertPNGTextChunk: (buffer, keyword, text) => {
                if (failure === 'insert') throw new Error('Metadata insertion failed');
                if (failure === 'missing') return buffer;
                return utils.insertPNGTextChunk(buffer, keyword, 'changed metadata');
            },
        });
        plugin.saveData = async (_name, data) => { history = data; };
        const result = await plugin.compressAllAssetImages(item => progress.push(item));
        assert.equal(result.failed, 1);
        assert.equal(result.compressed, 1, 'Other images must continue processing');
        assert.deepEqual(writes, [ordinaryPath]);
        assert.equal(stored.get(protectedPath), source);
        assert.equal(history.entries[protectedPath], undefined, 'Failed files must not be remembered as compressed');
        assert.ok(history.entries[ordinaryPath]);
        assert.deepEqual(progress.map(item => [item.current, item.total]), [[1, 2], [2, 2]]);
    });
}

test('batch compression writes validated metadata with the original filename', async () => {
    const path = 'data/assets/canvas.png';
    const source = new Blob([utils.insertPNGTextChunk(png, key, embedded), new Uint8Array(2048)]);
    let stored = source;
    const writes = [];
    const plugin = createPlugin({
        readDir: async () => [{ name: 'canvas.png' }],
        getFileBlob: async () => stored,
        putFile: async (target, _isDir, file) => {
            assert.equal(utils.readPNGTextChunk(new Uint8Array(await file.arrayBuffer()), key), embedded);
            writes.push([target, file.name]);
            stored = file;
        },
    });
    const result = await plugin.compressAllAssetImages();
    assert.equal(result.compressed, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(writes, [[path, 'canvas.png']]);
});

test('an image saved during compression is skipped without overwriting the new file', async () => {
    const original = new Blob([png, new Uint8Array(2048)]);
    const edited = new Blob([utils.insertPNGTextChunk(png, key, embedded)]);
    let stored = original;
    let history;
    const plugin = createPlugin({
        readDir: async () => [{ name: 'edited.png' }],
        getFileBlob: async () => stored,
        putFile: async () => assert.fail('A concurrently edited file must not be overwritten'),
    }, {
        reencodeImageBlob: async () => { stored = edited; return new Blob([png]); },
    });
    plugin.saveData = async (_name, data) => { history = data; };
    const result = await plugin.compressAllAssetImages();
    assert.equal(result.sourceChanged, 1);
    assert.equal(result.compressed, 0);
    assert.equal(result.failed, 0);
    assert.equal(stored, edited);
    assert.deepEqual(history.entries, {});
});

test('a batch uses its starting settings even when settings change during encoding', async () => {
    const paths = ['data/assets/first.png', 'data/assets/second.png'];
    const stored = new Map(paths.map(path => [path, new Blob([png, new Uint8Array(2048)])]));
    const plugin = createPlugin({
        readDir: async () => [{ name: 'first.png' }, { name: 'second.png' }],
        getFileBlob: async path => stored.get(path),
        putFile: async (path, _isDir, file) => { stored.set(path, file); },
    }, {
        reencodeImageBlob: async (_source, _format, options) => {
            assert.equal(options.pngMode, 'lossless');
            plugin.settings.pngCompressionMode = 'lossy';
            return new Blob([png]);
        },
    });
    const result = await plugin.compressAllAssetImages();
    assert.equal(result.compressed, 2);
});

test('cancellation during encoding prevents the pending overwrite', async () => {
    const controller = new AbortController();
    const source = new Blob([png, new Uint8Array(2048)]);
    const plugin = createPlugin({
        readDir: async () => [{ name: 'canceled.png' }],
        getFileBlob: async () => source,
        putFile: async () => assert.fail('An aborted batch must not write images'),
    }, {
        reencodeImageBlob: async () => { controller.abort(); return new Blob([png]); },
    });
    const result = await plugin.compressAllAssetImages(undefined, controller.signal);
    assert.equal(result.compressed, 0);
});

test('background task returns immediately, prevents duplicates and cleans up after completion', async () => {
    const messages = [];
    const summaries = [];
    const plugin = createPlugin({ pushMsg: async text => summaries.push(text) }, {}, messages);
    let hidden = true;
    plugin.assetCompressionStatus = {
        classList: { add: () => { hidden = true; }, remove: () => { hidden = false; } },
    };
    let finish;
    let runs = 0;
    plugin.compressAllAssetImages = async onProgress => {
        runs++;
        onProgress({ current: 1, total: 2, fileName: 'image.png' });
        return new Promise(resolve => { finish = resolve; });
    };
    assert.equal(plugin.startAssetImageCompression(), undefined);
    const task = plugin.assetCompressionTask;
    assert.ok(task instanceof Promise);
    assert.equal(hidden, false);
    plugin.startAssetImageCompression();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runs, 1);
    assert.equal(plugin.assetCompressionTask, task);
    assert.ok(messages.includes('settings.compressAllAssets.alreadyRunning'));
    assert.equal(plugin.assetCompressionStatus.textContent, 'settings.compressAllAssets.progress');
    assert.equal(plugin.assetCompressionStatus.title, 'settings.compressAllAssets.processing');
    finish({ total: 2, compressed: 1, remembered: 1, notSmaller: 0, failed: 0,
        sourceChanged: 0, originalSize: 200, savedSize: 100 });
    await task;
    assert.deepEqual(summaries, ['settings.compressAllAssets.summary']);
    assert.equal(hidden, true);
    assert.equal(plugin.assetCompressionTask, null);
    assert.equal(plugin.assetCompressionController, null);
});

test('failed background tasks report failure and allow another run', async () => {
    const errors = [];
    const messages = [];
    const plugin = createPlugin({
        pushErrMsg: async text => errors.push(text), pushMsg: async text => messages.push(text),
    });
    plugin.compressAllAssetImages = async () => { throw new Error('Cannot scan assets'); };
    plugin.startAssetImageCompression();
    await plugin.assetCompressionTask;
    assert.deepEqual(errors, ['common.errorWithDetail']);
    assert.equal(plugin.assetCompressionTask, null);
    plugin.compressAllAssetImages = async () => ({ total: 0 });
    plugin.startAssetImageCompression();
    assert.ok(plugin.assetCompressionTask instanceof Promise);
    await plugin.assetCompressionTask;
    assert.equal(plugin.assetCompressionTask, null);
    assert.deepEqual(messages, ['settings.compressAllAssets.empty']);
    assert.equal(errors.length, 1);
});
