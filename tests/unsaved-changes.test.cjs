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

function loadEditor({ choice = 'cancel', dirty = true, screenshot = false, write, read, fetchImplementation } = {}) {
    const closes = [];
    const writes = [];
    const errors = [];
    let prompts = 0;
    const source = readFileSync(resolve(__dirname, '../src/components/ImageEditor.svelte'), 'utf8')
        .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1].replace(/\bexport\s+/g, '');
    const editor = evaluate(source, {
        svelte: { onMount() {}, onDestroy() {}, createEventDispatcher: () => () => {}, tick: async () => {} },
        '../libs/dialog': { unsavedChangesDialog: async () => { prompts++; return typeof choice === 'function' ? choice() : choice; } },
        '../utils/i18n': { t: key => key },
        './editor/CanvasEditor.svelte': {},
        './editor/Toolbar.svelte': {},
        './editor/ToolSettings.svelte': {},
        '../api': {
            putFile: async (...args) => { writes.push(args); if (write) await write(...args); },
            getFileBlob: async () => read ? read() : new Blob(['saved']),
            getFileSize: async () => read ? (await read())?.size ?? null : writes.at(-1)[2].size,
            readDir: async () => [], removeFile: async () => {},
            pushMsg() {}, pushErrMsg: message => errors.push(message),
        },
        '../utils': { insertPNGTextChunk: buffer => buffer },
    }, `
        module.exports = { requestClose, isDirty, saveForSwitch, configure(fixture) {
            imagePath = 'assets/example.png'; originalFileName = 'example.png';
            imageBlob = new Blob(['original']); editorReady = true;
            settings = { storageMode: 'metadata', enableImageCompression: false };
            isScreenshotMode = fixture.screenshot; onClose = fixture.onClose;
            canvasEditorRef = {
                getHistoryIndex: () => fixture.dirty ? 1 : 0,
                toJSON: async () => ({}),
                toDataURL: async () => 'data:image/png;base64,cGl4ZWxz',
            };
        } };
    `, fetchImplementation);
    editor.configure({ dirty, screenshot, onClose: (...args) => closes.push(args) });
    return { ...editor, closes, writes, errors, prompts: () => prompts };
}

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
        removeConvertedSourceIfUnused: async () => {},
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
