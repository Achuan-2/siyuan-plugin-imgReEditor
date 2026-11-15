const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { File } = require('node:buffer');
const ts = require('typescript');

function evaluate(source, imports, suffix = '', fetchImplementation = async () => ({})) {
    const compiled = ts.transpileModule(source + suffix, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'File', 'fetch', 'document', compiled)(
        name => {
            assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
            return imports[name];
        }, module, module.exports, File, fetchImplementation, { querySelectorAll: () => [] }
    );
    return module.exports;
}

function loadEditor({ choice = 'cancel', dirty = true, screenshot = false, canvasHistory, write, read, fetchImplementation,
    compression = false, effort, blobExporter, format } = {}) {
    const closes = [];
    const writes = [];
    const errors = [];
    const encodes = [];
    let prompts = 0;
    const source = readFileSync(resolve(__dirname, '../src/components/ImageEditor.svelte'), 'utf8')
        .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1].replace(/\bexport\s+/g, '');
    const editor = evaluate(source, {
        svelte: { onMount() {}, onDestroy() {}, createEventDispatcher: () => () => {}, tick: async () => {} },
        '../libs/dialog': { unsavedChangesDialog: async () => { prompts++; return typeof choice === 'function' ? choice() : choice; } },
        '../utils/i18n': { t: key => key },
        '../defaultSettings': evaluate(readFileSync(resolve(__dirname, '../src/defaultSettings.ts'), 'utf8'), {}),
        '../utils/assetImageRefresh': evaluate(readFileSync(resolve(__dirname, '../src/utils/assetImageRefresh.ts'), 'utf8'), {}),
        './editor/CanvasEditor.svelte': {},
        './editor/Toolbar.svelte': {},
        './editor/ToolSettings.svelte': {},
        './editor/MaterialPanel.svelte': {},
        './editor/MaterialSaveDialog.svelte': {},
        '../api': {
            putFile: async (...args) => { writes.push(args); if (write) await write(...args); },
            getFileBlob: async () => read ? read() : new Blob(['saved']),
            getFileSize: async () => read ? (await read())?.size ?? null : writes.at(-1)[2].size,
            readDir: async () => [], removeFile: async () => {},
            pushMsg() {}, pushErrMsg: message => errors.push(message),
        },
        '../utils': { insertPNGTextChunk: buffer => buffer, insertWebPMetadata: buffer => buffer,
            reencodeImageBlob: async (blob, format, options) => { encodes.push({ blob, format, options }); return blob; } },
    }, `
        module.exports = { requestClose, isDirty, saveForSwitch, configure(fixture) {
            imagePath = 'assets/example.png'; originalFileName = 'example.png';
            imageBlob = new Blob(['original']); editorReady = true;
            settings = { storageMode: 'metadata', enableImageCompression: fixture.compression,
                saveCompressionSpeed: fixture.effort, compressionFormat: fixture.format ?? 'original' };
            isScreenshotMode = fixture.screenshot; onClose = fixture.onClose;
            isCanvasMode = !!fixture.canvasHistory;
            canvasEditorRef = {
                getHistoryIndex: () => fixture.dirty ? 1 : 0,
                toJSON: async () => ({}),
                toDataURL: async () => 'data:image/png;base64,cGl4ZWxz',
            };
            if (fixture.canvasHistory) Object.assign(canvasEditorRef, fixture.canvasHistory);
            if (fixture.blobExporter) canvasEditorRef.toBlob = fixture.blobExporter;
        } };
    `, fetchImplementation);
    editor.configure({ dirty, screenshot, canvasHistory, compression, effort, blobExporter, format, onClose: (...args) => closes.push(args) });
    return { ...editor, closes, writes, errors, encodes, prompts: () => prompts };
}

function loadCanvasHistory() {
    const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8')
        .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const parsed = ts.createSourceFile('CanvasEditor.ts', source, ts.ScriptTarget.Latest, true);
    const names = new Set(['isDirty', 'markSaved', 'getHistoryIndex', 'pushHistory', 'pushInitialHistory',
        'notifyHistoryUpdate']);
    const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name.text))
        .map(node => node.getText(parsed).replace(/^export\s+/, '')).join('\n');
    const schedule = parsed.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === 'schedulePushWithType'))
        .getText(parsed);
    return evaluate(`
        let history = [], historyIndex = -1, savedHistoryState = null;
        let pendingActionType = null, lastActionType = null, lastPushTime = 0;
        let version = 0, now = 1000, timer = null;
        const Date = { now: () => now };
        const setTimeout = callback => { timer = callback; return 1; };
        const clearTimeout = () => { timer = null; };
        const isCanvasMode = true, isHistoryProcessing = false, cropMode = false;
        const HISTORY_PROPS = [], MAX_HISTORY = 60;
        const canvas = { toJSON: () => ({ version }), getObjects: () => [],
            getWidth: () => 800, getHeight: () => 600 };
        const getCanvasLayout = () => ({ width: 800, height: 600 });
        const dispatch = () => {};
        ${functions}
        ${schedule}
        pushInitialHistory();
        module.exports = { isDirty, markSaved, getHistoryIndex, reset: pushInitialHistory,
            edit(type = 'modified') { version++; schedulePushWithType(type); },
            flush(elapsed = 200) { now += elapsed; const callback = timer; timer = null; callback?.(); },
            restore(index) { historyIndex = index; },
            hasPendingUpdate: () => timer !== null,
        };
    `, {});
}

test('canvas exit prompts even before the debounced history update', async () => {
    for (const choice of ['cancel', 'discard', 'save']) {
        const canvasHistory = loadCanvasHistory();
        canvasHistory.edit();
        assert.equal(canvasHistory.getHistoryIndex(), 0);
        const editor = loadEditor({ choice, canvasHistory });
        await editor.requestClose();
        assert.equal(editor.prompts(), 1);
        assert.equal(editor.closes.length, choice === 'cancel' ? 0 : 1);
        assert.equal(editor.writes.length, choice === 'save' ? 1 : 0);
        if (choice === 'save') {
            assert.equal(editor.closes[0][0], true);
            assert.equal(editor.isDirty(), false);
            assert.equal(canvasHistory.hasPendingUpdate(), false);
        }
    }
});

test('canvas save establishes a clean state and later edits prompt again', async () => {
    const canvasHistory = loadCanvasHistory();
    const clean = loadEditor({ canvasHistory });
    await clean.requestClose();
    assert.equal(clean.prompts(), 0);
    canvasHistory.edit();
    canvasHistory.flush();
    const editor = loadEditor({ canvasHistory });
    await editor.saveForSwitch();
    assert.equal(editor.isDirty(), false);
    canvasHistory.edit();
    canvasHistory.flush();
    await editor.requestClose();
    assert.equal(editor.prompts(), 1);
    assert.equal(editor.closes.length, 0);
});

test('canvas dirty state survives history merges, replacement branches and the history limit', () => {
    const canvas = loadCanvasHistory();
    canvas.edit();
    canvas.flush();
    canvas.edit();
    canvas.flush();
    assert.equal(canvas.getHistoryIndex(), 1);
    assert.equal(canvas.isDirty(), true);
    canvas.markSaved();
    canvas.restore(0);
    assert.equal(canvas.isDirty(), true);
    canvas.edit('added');
    canvas.flush();
    assert.equal(canvas.getHistoryIndex(), 1);
    assert.equal(canvas.isDirty(), true);
    canvas.markSaved();
    canvas.edit();
    canvas.flush();
    canvas.restore(1);
    assert.equal(canvas.isDirty(), false);

    for (let i = 0; i < 65; i++) {
        canvas.edit('added');
        canvas.flush(1000);
    }
    assert.equal(canvas.getHistoryIndex(), 59);
    canvas.markSaved();
    canvas.edit();
    canvas.flush(1000);
    assert.equal(canvas.getHistoryIndex(), 59);
    assert.equal(canvas.isDirty(), true);
});

test('failed canvas saves retain unsaved edits and prompt again', async context => {
    context.mock.method(console, 'error', () => {});
    const canvasHistory = loadCanvasHistory();
    canvasHistory.edit();
    const editor = loadEditor({ choice: 'save', canvasHistory, write: () => { throw new Error('Write denied'); } });
    await editor.requestClose();
    assert.equal(editor.closes.length, 0);
    assert.equal(editor.isDirty(), true);
    await editor.requestClose();
    assert.equal(editor.prompts(), 2);
});

test('loading a canvas clears pending initialization history and starts clean', () => {
    const canvas = loadCanvasHistory();
    canvas.edit();
    canvas.reset();
    assert.equal(canvas.isDirty(), false);
    assert.equal(canvas.hasPendingUpdate(), false);
    canvas.flush();
    assert.equal(canvas.getHistoryIndex(), 0);
    canvas.edit();
    assert.equal(canvas.isDirty(), true);
});

test('discard exits without writing; cancelling the prompt preserves edits', async () => {
    const discard = loadEditor({ choice: 'discard' });
    await discard.requestClose();
    assert.deepEqual(discard.closes, [[false]]);
    assert.equal(discard.writes.length, 0);
    const cancel = loadEditor();
    await cancel.requestClose();
    assert.equal(cancel.closes.length, 0);
    assert.equal(cancel.isDirty(), true);
});

test('edited image and screenshot saves use Blob export and default to fast compression', async () => {
    for (const screenshot of [false, true]) {
        const raster = new Blob(['direct raster'], { type: 'image/png' });
        const exports = [];
        const editor = loadEditor({ choice: 'save', screenshot, compression: true,
            blobExporter: async options => { exports.push(options); return raster; } });
        await editor.requestClose();
        assert.deepEqual(exports, [{ format: 'png', quality: 1 }]);
        assert.equal(editor.encodes[0].blob, raster);
        assert.equal(editor.encodes[0].options.effort, 'fast');
        assert.equal(editor.encodes[0].options.pngMode, 'lossless');
        assert.equal(editor.closes[0][0], true);
    }
});

test('balanced save compression is honored and failed Blob export keeps the editor open', async () => {
    const editor = loadEditor({ choice: 'save', compression: true, effort: 'balanced',
        blobExporter: async () => new Blob(['raster']) });
    await editor.requestClose();
    assert.equal(editor.encodes[0].options.effort, 'balanced');
    const failed = loadEditor({ choice: 'save', blobExporter: async () => null });
    await failed.requestClose();
    assert.equal(failed.writes.length, 0);
    assert.equal(failed.closes.length, 0);
    assert.equal(failed.isDirty(), true);
});

test('edited images and screenshots follow the global format and JPEG keeps a project backup', async () => {
    for (const screenshot of [false, true]) {
        for (const format of ['png', 'jpeg', 'webp', 'original']) {
            const editor = loadEditor({ choice: 'save', screenshot, compression: true, format,
                blobExporter: async () => new Blob(['pixels']) });
            await editor.requestClose();
            assert.equal(editor.errors.length, 0);
            assert.equal(editor.closes[0][0], true);
            const images = editor.writes.filter(([path]) => !path.endsWith('.json'));
            const output = format === 'original' ? 'png' : format;
            assert.equal(images.length, 1);
            assert.equal(images[0][2].type, `image/${output}`);
            assert.ok(images[0][0].endsWith(output === 'jpeg' ? '.jpg' : `.${output}`));
            const backups = editor.writes.filter(([path]) => path.endsWith('.json'));
            assert.equal(backups.length, format === 'jpeg' ? 1 : 0);
            if (backups.length) assert.deepEqual(JSON.parse(await backups[0][2].text()).canvasJSON, {});
        }
    }
});

test('unchanged images exit directly without a prompt', async () => {
    const editor = loadEditor({ dirty: false });
    await editor.requestClose();
    assert.deepEqual(editor.closes, [[false]]);
    assert.equal(editor.prompts(), 0);
});

test('repeated close requests share one pending prompt', async () => {
    let finish;
    const choice = new Promise(resolve => { finish = resolve; });
    const editor = loadEditor({ choice: () => choice });
    const first = editor.requestClose();
    await editor.requestClose();
    assert.equal(editor.prompts(), 1);
    finish('cancel');
    await first;
    await editor.requestClose();
    assert.equal(editor.prompts(), 2);
});

test('save and exit waits for the file write before closing', async () => {
    let finish;
    const pendingWrite = new Promise(resolve => { finish = resolve; });
    const editor = loadEditor({ choice: 'save', write: () => pendingWrite });
    const closing = editor.requestClose();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.writes.length, 1);
    assert.deepEqual(editor.writes[0][3], { throwOnError: true });
    assert.equal(editor.closes.length, 0);
    await editor.requestClose();
    assert.equal(editor.prompts(), 1);
    finish();
    await closing;
    assert.equal(editor.closes[0][0], true);
    assert.equal(editor.closes[0][1], 'assets/example.png');
});

test('failed save verification keeps the editor open and dirty', async () => {
    const editor = loadEditor({ choice: 'save', read: () => null });
    await editor.requestClose();
    assert.equal(editor.closes.length, 0);
    assert.equal(editor.isDirty(), true);
    assert.deepEqual(editor.errors, ['imageEditor.assetsSaveFailed']);
});

test('a mismatched saved file size keeps the editor open', async () => {
    const editor = loadEditor({ choice: 'save', read: () => new Blob(['wrong size']) });
    await editor.requestClose();
    assert.equal(editor.closes.length, 0);
    assert.equal(editor.isDirty(), true);
});

test('save completion does not wait for a duplicate asset refresh request', async () => {
    let fetches = 0;
    const editor = loadEditor({ choice: 'save', fetchImplementation: () => { fetches++; return new Promise(() => {}); } });
    await editor.requestClose();
    assert.equal(fetches, 0);
    assert.equal(editor.closes[0][0], true);
});

test('file size verification cancels the body when a reliable length is available', async () => {
    let cancelled = false;
    const api = evaluate(readFileSync(resolve(__dirname, '../src/api.ts'), 'utf8'), { siyuan: {} }, '', async () => ({
        ok: true, headers: new Headers({ 'content-length': '123' }),
        body: { cancel: async () => { cancelled = true; } },
        blob: () => { throw new Error('File contents must not be downloaded'); },
    }));
    assert.equal(await api.getFileSize('data/assets/example.png'), 123);
    assert.equal(cancelled, true);
});

test('file size verification falls back to the decoded body for missing or compressed length headers', async () => {
    for (const headers of [{}, { 'content-length': '3', 'content-encoding': 'gzip' }]) {
        const api = evaluate(readFileSync(resolve(__dirname, '../src/api.ts'), 'utf8'), { siyuan: {} }, '', async () => ({
            ok: true, headers: new Headers(headers), blob: async () => new Blob(['decoded']),
        }));
        assert.equal(await api.getFileSize('data/assets/example.png'), 7);
    }
    const api = evaluate(readFileSync(resolve(__dirname, '../src/api.ts'), 'utf8'), { siyuan: {} }, '', async () => ({ ok: false }));
    assert.equal(await api.getFileSize('data/assets/missing.png'), null);
});

test('write failures keep both image and screenshot editors open for retry', async context => {
    context.mock.method(console, 'error', () => {});
    for (const screenshot of [false, true]) {
        const editor = loadEditor({ choice: 'save', screenshot, write: () => { throw new Error('Write denied'); } });
        await editor.requestClose();
        assert.equal(editor.closes.length, 0);
        assert.equal(editor.isDirty(), true);
        assert.deepEqual(editor.errors, ['imageEditor.saveFailed']);
        await editor.requestClose();
        assert.equal(editor.prompts(), 2);
    }
});

test('screenshot save and exit writes history and then closes', async () => {
    const editor = loadEditor({ choice: 'save', screenshot: true });
    await editor.requestClose();
    assert.match(editor.writes[0][0], /screenshot_history\/screenshot-\d+\.png$/);
    assert.equal(editor.closes[0][0], true);
    assert.equal(editor.isDirty(), false);
});

test('switch preparation saves edits without closing or prompting', async () => {
    const editor = loadEditor();
    const result = await editor.saveForSwitch();
    assert.equal(result.newPath, 'assets/example.png');
    assert.equal(editor.writes.length, 1);
    assert.equal(editor.closes.length, 0);
    assert.equal(editor.prompts(), 0);
    assert.equal(editor.isDirty(), false);
    await editor.saveForSwitch();
    assert.equal(editor.writes.length, 1);
});

test('switch preparation reuses a screenshot history path after saving', async () => {
    const editor = loadEditor({ screenshot: true });
    const first = await editor.saveForSwitch();
    assert.match(first.newPath, /screenshot_history\/screenshot-\d+\.png$/);
    const second = await editor.saveForSwitch();
    assert.equal(second.newPath, first.newPath);
    assert.equal(editor.writes.length, 1);
    assert.equal(editor.closes.length, 0);
});

function loadTabSwitch(editor, { onSaveCallback, openTab, updateReference } = {}) {
    let listener;
    const opened = [];
    const errors = [];
    const dialog = { destroy: () => editor.closes.push(['dialog']) };
    const source = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8')
        .match(/        let pendingTabSave:[\s\S]*?(?=        \/\/ Intercept dialog destruction)/)[0];
    const { install } = evaluate(`module.exports.install = function(fixture) {
        const { comp, dialog, imagePath, blockID, onSaveCallback } = fixture;
        const t = key => key;
        let openingInTab = false; let canvasNavigationBusy = false;
        ${source}
    };`, { './api': { pushErrMsg: message => errors.push(message) } });
    install.call({
        openImageEditorInTab: async (...args) => { opened.push(args); if (openTab) await openTab(...args); },
        replaceImageAssetReferenceInBlock: async (...args) => { if (updateReference) await updateReference(...args); },
    }, {
        comp: { ...editor, $on: (event, callback) => { listener = callback; } }, dialog,
        imagePath: 'assets/example.png', blockID: 'block', onSaveCallback,
    });
    return { switchToTab: (screenshot = false) => listener({ detail: { isCanvasMode: false, isScreenshotMode: screenshot } }), opened, errors };
}

test('tab switching waits for saving and blocks duplicate switches', async () => {
    let finish;
    const pendingWrite = new Promise(resolve => { finish = resolve; });
    const editor = loadEditor({ write: () => pendingWrite });
    const tabs = loadTabSwitch(editor);
    const switching = tabs.switchToTab();
    await new Promise(resolve => setImmediate(resolve));
    await tabs.switchToTab();
    assert.equal(tabs.opened.length, 0);
    assert.equal(editor.closes.length, 0);
    finish();
    await switching;
    assert.equal(editor.writes.length, 1);
    assert.deepEqual(tabs.opened, [['assets/example.png', null, false, false]]);
    assert.deepEqual(editor.closes, [['dialog']]);
});

test('failed saves do not switch to a tab or close the dialog', async () => {
    const editor = loadEditor({ read: () => null });
    const tabs = loadTabSwitch(editor);
    await tabs.switchToTab();
    assert.equal(tabs.opened.length, 0);
    assert.equal(editor.closes.length, 0);
    assert.equal(editor.isDirty(), true);
});

test('unchanged images switch directly without another save', async () => {
    const editor = loadEditor({ dirty: false });
    const tabs = loadTabSwitch(editor);
    await tabs.switchToTab();
    assert.equal(editor.writes.length, 0);
    assert.equal(tabs.opened[0][0], 'assets/example.png');
    assert.deepEqual(editor.closes, [['dialog']]);
});

test('screenshots open in a tab from their saved history file', async () => {
    const editor = loadEditor({ screenshot: true });
    const tabs = loadTabSwitch(editor);
    await tabs.switchToTab(true);
    assert.match(tabs.opened[0][0], /screenshot_history\/screenshot-\d+\.png$/);
    assert.equal(tabs.opened[0][3], true);
    assert.deepEqual(editor.closes, [['dialog']]);
});

test('converted asset references update before opening the new path', async () => {
    const events = [];
    const editor = { closes: [], saveForSwitch: async () => ({ sourcePath: 'assets/example.png', newPath: 'assets/example.webp', blockId: 'block' }) };
    const tabs = loadTabSwitch(editor, {
        onSaveCallback: async path => events.push(['reference', path]),
        openTab: async path => events.push(['tab', path]),
    });
    await tabs.switchToTab();
    assert.deepEqual(events, [['reference', 'assets/example.webp'], ['tab', 'assets/example.webp']]);
    assert.deepEqual(editor.closes, [['dialog']]);
});

test('reference failures retain the original path for a later retry', async context => {
    context.mock.method(console, 'error', () => {});
    let saves = 0;
    let updates = 0;
    const editor = { closes: [], saveForSwitch: async () => ({ sourcePath: saves++ ? 'assets/example.webp' : 'assets/example.png', newPath: 'assets/example.webp', blockId: 'block' }) };
    const tabs = loadTabSwitch(editor, { onSaveCallback: async () => { if (++updates === 1) throw new Error('Reference update failed'); } });
    await tabs.switchToTab();
    assert.equal(editor.closes.length, 0);
    assert.equal(tabs.opened.length, 0);
    await tabs.switchToTab();
    assert.equal(updates, 2);
    assert.equal(tabs.opened[0][0], 'assets/example.webp');
});

test('strict file writes reject API errors even when an old file exists', async () => {
    let response = { code: 1, msg: 'Write denied', data: null };
    const api = evaluate(readFileSync(resolve(__dirname, '../src/api.ts'), 'utf8'), {
        siyuan: { fetchSyncPost: async () => response },
    });
    await assert.rejects(api.putFile('data/assets/example.png', false, new Blob(['new']), { throwOnError: true }), /Write denied/);
    assert.equal(await api.putFile('data/assets/example.png', false, new Blob(['new'])), null);
    response = { code: 0, data: null };
    assert.equal(await api.putFile('data/assets/example.png', false, new Blob(['new']), { throwOnError: true }), null);
});

test('prompt buttons resolve their actions; closing the prompt resolves cancel', async () => {
    let current;
    class FakeDialog {
        constructor(options) {
            this.options = options;
            this.nodes = new Map();
            this.element = { querySelector: selector => {
                if (!this.nodes.has(selector)) this.nodes.set(selector, { addEventListener: (event, handler) => { this.nodes.get(selector)[event] = handler; } });
                return this.nodes.get(selector);
            } };
            current = this;
        }
        destroy() { this.options.destroyCallback(); }
    }
    const { unsavedChangesDialog } = evaluate(readFileSync(resolve(__dirname, '../src/libs/dialog.ts'), 'utf8'), {
        siyuan: { Dialog: FakeDialog },
    });
    for (const action of ['discard', 'save', 'cancel']) {
        const result = unsavedChangesDialog({ title: '未保存的修改', message: '提示', discardLabel: '不保存退出', saveLabel: '保存并退出' });
        assert.equal(current.nodes.get('[data-action="discard"]').textContent, '不保存退出');
        assert.equal(current.nodes.get('[data-action="save"]').textContent, '保存并退出');
        if (action === 'cancel') current.destroy();
        else current.nodes.get(`[data-action="${action}"]`).click();
        assert.equal(await result, action);
    }
});
