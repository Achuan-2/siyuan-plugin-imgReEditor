const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { Textbox, Point, setEnv } = require('fabric');
const presetModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(
    resolve(__dirname, '../src/components/editor/textStylePresets.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(require, presetModule, presetModule.exports);
const { getTextStrokeStrength, textStrokeStrengthToWidth } = presetModule.exports;

setEnv({
    document: { createElement: () => ({ getContext: () => ({ measureText: text => ({ width: [...text].length * 200 }) }) }) },
    window: { devicePixelRatio: 1 }, isTouchSupported: false,
    WebGLProbe: {}, copyPasteData: {}, dispose() {},
});

const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('CanvasEditor.ts', source, ts.ScriptTarget.Latest, true);
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) &&
    ['pastePlainText', 'autoResizeTextObject'].includes(node.name.text))
    .map(node => node.getText(parsed)).join('\n');
const paste = parsed.statements.find(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === 'onPaste'));
const compiled = ts.transpileModule(`${functions}\n${paste.getText(parsed)}\nreturn onPaste;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture({ active = null, target = {}, tool = null, clipboard = [] } = {}) {
    const added = [], history = [], images = [];
    let shapePastes = 0;
    const center = new Point(340, 280);
    const canvas = {
        getActiveObject: () => active, getVpCenter: () => center,
        add: object => added.push(object),
        setActiveObject: object => { active = object; }, requestRenderAll() {},
    };
    const textOptions = { family: 'Arial', size: 32, fill: '#123456', bold: true };
    const onPaste = new Function('canvas', 'Textbox', 'activeTool', 'activeToolOptions', 'settings',
        'getTextStrokeOptions', 'getTextBackgroundOptions', 'applyTextShadow',
        'applyTextRenderingOptions', 'schedulePushWithType', 'clipboard', 'pasteClipboard',
        'addFabricImageFromURL', 'FileReader', 'getTextStrokeStrength', 'textStrokeStrengthToWidth', compiled)(
        canvas, Textbox, tool, { fill: '#ff0000', size: 99 }, { lastToolSettings: { text: textOptions } },
        () => ({ strokeWidth: 0 }), () => ({}), () => {}, () => {}, type => history.push(type),
        clipboard, () => shapePastes++, url => images.push(url),
        class {
            readAsDataURL(file) { this.onload({ target: { result: file.url } }); }
        },
        getTextStrokeStrength, textStrokeStrengthToWidth,
    );
    return {
        added, history, images, center, get shapePastes() { return shapePastes; },
        paste(text, extra = {}) {
            const event = {
                target, defaultPrevented: false,
                clipboardData: { getData: () => text, files: [], items: [] },
                preventDefault() { this.defaultPrevented = true; }, ...extra,
            };
            onPaste(event);
            return event;
        },
    };
}

test('cut text pastes as an editable textbox without a text tool, with history and visible placement', () => {
    for (const tool of [null, 'arrow']) {
        const editor = fixture({ tool });
        assert.equal(editor.paste('剪切的文字\r\n第二行😀').defaultPrevented, true);
        assert.equal(editor.added.length, 1);
        const text = editor.added[0];
        assert.ok(text instanceof Textbox);
        assert.equal(text.text, '剪切的文字\n第二行😀');
        assert.equal(text.fontSize, 32);
        assert.equal(text.fill, '#123456');
        assert.equal(text.fontWeight, 'bold');
        assert.equal(text.selectable, true);
        assert.equal(text.evented, true);
        assert.ok(text.getCenterPoint().eq(editor.center));
        assert.ok(text.width > 1);
        assert.deepEqual(editor.history, ['added']);
    }
});

test('editing text and native form fields retain native paste instead of creating a textbox', () => {
    for (const state of [
        { active: { type: 'textbox', isEditing: true } },
        { active: { type: 'i-text', isEditing: true } },
        ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ target: { tagName } })),
        { target: { isContentEditable: true } },
    ]) {
        const editor = fixture(state);
        assert.equal(editor.paste('文字').defaultPrevented, false);
        assert.equal(editor.added.length, 0);
    }
    const editor = fixture();
    editor.paste('文字', { defaultPrevented: true });
    assert.equal(editor.added.length, 0);
});

test('canvas shape markers, images and empty clipboard do not create textboxes', () => {
    const editor = fixture({ clipboard: [{ type: 'rect' }] });
    assert.equal(editor.paste('__CANVAS_SHAPES__[]').defaultPrevented, true);
    assert.equal(editor.shapePastes, 1);
    const emptyEditor = fixture();
    emptyEditor.paste('__CANVAS_SHAPES__[]');
    emptyEditor.paste('');
    assert.equal(emptyEditor.added.length, 0);
    editor.paste('image fallback text', {
        clipboardData: { getData: () => 'image fallback text', files: [{ type: 'image/png', url: 'data:image/png;base64,abc' }] },
    });
    assert.deepEqual(editor.images, ['data:image/png;base64,abc']);
    assert.equal(editor.added.length, 0);
});
