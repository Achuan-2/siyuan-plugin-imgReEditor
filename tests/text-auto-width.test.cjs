const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { Textbox, IText, FabricText, setEnv } = require('fabric');

// Exercise Fabric's real wrapping with deterministic font metrics, without a browser.
setEnv({
    document: { createElement: () => ({ getContext: () => ({ measureText: text => ({ width: [...text].length * 201.25 }) }) }) },
    window: { devicePixelRatio: 1 }, isTouchSupported: false,
    WebGLProbe: {}, copyPasteData: {}, dispose() {},
});

const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('CanvasEditor.ts', source, ts.ScriptTarget.Latest, true);
const functionNames = [
    'autoResizeTextObject', 'isTextObject', 'restoreObjectSelectionStates',
    'normalizeTextResizeMode', 'getTextResizeMode', 'getTextResizeModeForEvent',
    'getTextResizeActionHandler',
    'applyToolOptionsToSelection',
];
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && functionNames.includes(node.name.text))
    .map(node => node.getText(parsed).replace(/^export\s+/, '')).join('\n');
const creation = source.slice(source.indexOf('                    let itext: any = null;'), source.indexOf('                    // try to enter editing mode'));
const beforeTransform = source.match(/        canvas\.on\('before:transform',[\s\S]*?(?=        \/\/ A newly created textbox)/)[0];
const compiled = ts.transpileModule(`
    const DEFAULT_TEXT_RESIZE_MODE = 'layout';
    const activeTool = 'text';
    const activeToolOptions = { textResizeMode: 'layout' };
    let beforeResize;
    let objects = [];
    let history = [];
    const canvas = {
        on: (event, callback) => { beforeResize = callback; },
        add: object => objects.push(object), getObjects: () => objects,
        getActiveObjects: () => objects,
        setActiveObject() {}, requestRenderAll() {},
    };
    function applyTextRenderingOptions() {}
    function applyTextBackgroundRenderer() {}
    function hasTextBackgroundOption() { return false; }
    function getTextBackgroundOptions() { return {}; }
    function getTextStrokeOptions() { return {}; }
    function schedulePushWithType() {
        history.push(objects.map(object => object.toObject(['_textAutoWidth'])));
    }
    ${functions}
    ${beforeTransform}
    return {
        autoResizeTextObject, restoreObjectSelectionStates, beforeResize,
        applyToolOptionsToSelection,
        getHistory: () => history,
        setObjects: value => { objects = value; },
        createText(value, textAlign) {
            activeToolOptions.textAlign = textAlign;
            const t = () => value;
            const pointer = { x: 30, y: 50 };
            const fontFamily = 'test', fontSize = 24, fill = '#000000';
            const textStrokeOptions = {}, textBackgroundOptions = {};
            const fontWeight = 'normal', fontStyle = 'normal', underline = false;
            ${creation}
            return itext;
        },
    };
`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

function loadTextHelpers(changeWidth = () => false) {
    return new Function('Textbox', 'IText', 'Text', 'controlsUtils', compiled)(
        Textbox, IText, FabricText, { changeWidth }
    );
}

test('new text starts on one line at its natural width', () => {
    const helpers = loadTextHelpers();
    for (const text of ['Text', '中文标注', 'Long label with spaces 123']) {
        const textbox = helpers.createText(text);
        assert.deepEqual(textbox.textLines, [text]);
        assert.ok(textbox.width >= textbox.calcTextWidth());
        assert.equal(textbox.left, 30);
        assert.equal(textbox.top, 50);
        assert.equal(textbox._textAutoWidth, true);
    }
});

test('automatic width grows and shrinks with content, preserving explicit line breaks', () => {
    const helpers = loadTextHelpers();
    const textbox = helpers.createText('Text');
    const initialWidth = textbox.width;
    textbox.set('text', 'A much longer text label');
    helpers.autoResizeTextObject(textbox);
    assert.deepEqual(textbox.textLines, ['A much longer text label']);
    assert.ok(textbox.width > initialWidth);
    textbox.set('text', 'A');
    helpers.autoResizeTextObject(textbox);
    assert.ok(textbox.width < initialWidth);
    textbox.set('text', 'First line\n第二行');
    helpers.autoResizeTextObject(textbox);
    assert.deepEqual(textbox.textLines, ['First line', '第二行']);
});

test('font changes keep automatic text on one line', () => {
    const helpers = loadTextHelpers();
    const textbox = helpers.createText('Text');
    const previousWidth = textbox.width;
    textbox.set({ fontSize: 48, charSpacing: 200 });
    helpers.autoResizeTextObject(textbox);
    assert.deepEqual(textbox.textLines, ['Text']);
    assert.ok(textbox.width > previousWidth);
});

test('new text uses the chosen alignment and defaults to left', () => {
    const helpers = loadTextHelpers();
    for (const alignment of [undefined, 'left', 'center', 'right']) {
        const textbox = helpers.createText('Long line\nShort', alignment);
        assert.equal(textbox.textAlign, alignment || 'left');
        const remainingWidth = textbox.width - textbox.getLineWidth(1);
        const expectedOffset = alignment === 'center' ? remainingWidth / 2
            : alignment === 'right' ? remainingWidth : 0;
        assert.equal(textbox._getLineLeftOffset(1), expectedOffset);
    }
});

test('alignment updates selected text boxes while editing and survives history restoration', () => {
    const helpers = loadTextHelpers();
    const editing = helpers.createText('Long line\nShort');
    // Cursor blinking needs a browser; retain the real editing/layout logic.
    editing.initDelayedCursor = () => {};
    editing.isEditing = true;
    editing.selectionStart = 0;
    editing.selectionEnd = 4;
    editing.setSelectionStyles({ fill: '#ff0000', fontWeight: 'bold' });
    const styles = structuredClone(editing.styles);
    const fixed = new Textbox('Long line\nShort', {
        width: 200, fontSize: 24, splitByGrapheme: true, _textAutoWidth: false,
    });
    const lines = [...fixed.textLines];
    helpers.setObjects([editing, fixed]);

    for (const alignment of ['center', 'right', 'left']) {
        helpers.applyToolOptionsToSelection({ textAlign: alignment });
        assert.equal(editing.textAlign, alignment);
        assert.deepEqual(editing.styles, styles);
        assert.equal(fixed.width, 200);
        assert.deepEqual(fixed.textLines, lines);

        const snapshot = helpers.getHistory().at(-1);
        assert.equal(snapshot.length, 2);
        for (const saved of snapshot) {
            const { type, ...options } = saved;
            const restored = new Textbox(saved.text, options);
            assert.equal(restored.textAlign, alignment);
            assert.equal(restored.width, saved.width);
            assert.deepEqual(restored.styles, saved.styles);
        }
    }
    assert.equal(helpers.getHistory().length, 3);
});

test('restoring automatic text repairs narrow widths but retains manual wrapping', () => {
    const helpers = loadTextHelpers();
    const automatic = new Textbox('Text', { width: 12, fontSize: 24, splitByGrapheme: true, _textAutoWidth: true });
    const fixed = new Textbox('Text', { width: 12, fontSize: 24, splitByGrapheme: true, _textAutoWidth: false });
    const fixedWidth = fixed.width;
    helpers.setObjects([automatic, fixed]);
    helpers.restoreObjectSelectionStates();
    assert.deepEqual(automatic.textLines, ['Text']);
    assert.equal(fixed.width, fixedWidth);
    assert.equal(fixed.textLines.length, 4);
});

test('clicking a resize handle retains auto width; actual resizing switches to fixed width', () => {
    let changed = false;
    const helpers = loadTextHelpers((event, transform) => {
        if (!changed) return false;
        transform.target.set('width', 25);
        return true;
    });
    const textbox = helpers.createText('Text');
    const transform = { target: textbox, corner: 'mr', actionHandler: () => false };
    helpers.beforeResize({ e: {}, transform });
    assert.equal(textbox._textAutoWidth, true);
    assert.equal(transform.actionHandler({}, transform, 0, 0), false);
    assert.equal(textbox._textAutoWidth, true);
    changed = true;
    assert.equal(transform.actionHandler({}, transform, 0, 0), true);
    assert.equal(textbox._textAutoWidth, false);
    textbox.set('text', 'Text grows after a manual resize');
    helpers.autoResizeTextObject(textbox);
    assert.equal(textbox.width, 25);
    assert.ok(textbox.textLines.length > 1);
    const saved = textbox.toObject(['_textAutoWidth']);
    const { type, ...options } = saved;
    const restored = new Textbox(saved.text, options);
    helpers.autoResizeTextObject(restored);
    assert.equal(restored.width, 25);
    assert.equal(restored._textAutoWidth, false);
});
