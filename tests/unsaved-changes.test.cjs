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
