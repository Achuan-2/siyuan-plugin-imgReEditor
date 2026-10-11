const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { Textbox, IText, FabricText, setEnv } = require('fabric');
const presetModule = { exports: {} };
const presetSource = readFileSync(resolve(__dirname, '../src/components/editor/textStylePresets.ts'), 'utf8');
new Function('require', 'module', 'exports', ts.transpileModule(presetSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(require, presetModule, presetModule.exports);
const { applyTextShadow, getTextShadowOptions, hasTextShadowOption,
    TEXT_STYLE_PRESETS, getTextStylePresetOptions } = presetModule.exports;
const radiusModule = { exports: {} };
new Function('module', 'exports', ts.transpileModule(
    readFileSync(resolve(__dirname, '../src/components/editor/textBackgroundRadius.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText)(radiusModule, radiusModule.exports);
const { getTextBackgroundRadiusPercent } = radiusModule.exports;
const rangeModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(
    readFileSync(resolve(__dirname, '../src/components/editor/textRangeStyles.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText)(name => name === './textStylePresets' ? presetModule.exports : require(name), rangeModule, rangeModule.exports);
const { hasTextRange, getTextSelectionOptions, setRangeTextShadow, clearRangeTextShadows, installTextRangeRenderer } = rangeModule.exports;

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
    'normalizeTextStrokeWidth', 'getTextStrokeOptions',
    'clampNumber', 'hasTextBackgroundOption', 'getTextBackgroundOptions',
];
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && functionNames.includes(node.name.text))
    .map(node => node.getText(parsed).replace(/^export\s+/, '')).join('\n');
const creation = source.slice(source.indexOf('                    let itext: any = null;'), source.indexOf('                    // try to enter editing mode'));
const beforeTransform = source.match(/        canvas\.on\('before:transform',[\s\S]*?(?=        \/\/ A newly created textbox)/)[0];
const compiled = ts.transpileModule(`
    const DEFAULT_TEXT_RESIZE_MODE = 'layout';
    const MAX_TEXT_STROKE_WIDTH = 20;
    ${source.match(/const TEXT_BACKGROUND_PROPS = \[[\s\S]*?\];/)[0]}
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
    function applyTextRenderingOptions(text) { installTextRangeRenderer(text); }
    function applyTextBackgroundRenderer(text) { installTextRangeRenderer(text); }
    const colorWithOpacity = color => color;
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
        createText(value, textAlign, options = {}) {
            Object.assign(activeToolOptions, options, { textAlign });
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
    return new Function('Textbox', 'IText', 'Text', 'controlsUtils',
        'applyTextShadow', 'getTextShadowOptions', 'hasTextShadowOption', 'getTextBackgroundRadiusPercent',
        'hasTextRange', 'setRangeTextShadow', 'clearRangeTextShadows', 'installTextRangeRenderer', compiled)(
        Textbox, IText, FabricText, { changeWidth },
        applyTextShadow, getTextShadowOptions, hasTextShadowOption, getTextBackgroundRadiusPercent,
        hasTextRange, setRangeTextShadow, clearRangeTextShadows, installTextRangeRenderer
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

test('templates style the whole editable title without a text range and survive save/history restoration', async () => {
    for (const preset of TEXT_STYLE_PRESETS) {
        const helpers = loadTextHelpers();
        const textbox = helpers.createText('Cover title', 'right');
        textbox.set({ fontSize: 60, fontFamily: 'test', left: 30, top: 50 });
        textbox.initDelayedCursor = () => {};
        textbox.isEditing = true;
        textbox.selectionStart = 0;
        textbox.selectionEnd = 2;
        textbox.setSelectionStyles({ fill: '#00ff00', fontWeight: 'normal', strokeWidth: 10 });
        textbox.selectionEnd = 0;
        helpers.setObjects([textbox]);
        const options = getTextStylePresetOptions(preset, textbox.fontSize);
        helpers.applyToolOptionsToSelection(options);
        assert.equal(textbox.text, 'Cover title');
        assert.equal(textbox.fontSize, 60);
        assert.equal(textbox.fontFamily, 'test');
        assert.equal(textbox.textAlign, 'right');
        assert.equal(textbox.left, 30);
        assert.equal(textbox.top, 50);
        assert.equal(textbox.fill, preset.fill);
        assert.equal(textbox.fontWeight, options.bold ? 'bold' : 'normal');
        assert.equal(textbox.strokeWidth, options.strokeWidth);
        assert.equal(textbox.textBackgroundEnabled, !!preset.background);
        assert.equal(!!textbox.shadow, preset.shadow);
        assert.equal(textbox.styles[0]?.[0]?.fill, undefined);
        assert.equal(textbox.styles[0]?.[0]?.fontWeight, undefined);
        for (const saved of [textbox.toObject(['textBackgroundEnabled', 'textBackgroundFill']),
            helpers.getHistory().at(-1)[0]]) {
            const restored = await Textbox.fromObject(saved);
            assert.equal(restored.text, textbox.text);
            assert.equal(restored.fill, preset.fill);
            assert.equal(restored.strokeWidth, options.strokeWidth);
            assert.deepEqual(getTextShadowOptions(restored), getTextShadowOptions(textbox));
            restored.set('text', 'Still editable');
            assert.equal(restored.text, 'Still editable');
        }
    }
});

test('text shadow can be created, independently adjusted and disabled', () => {
    const helpers = loadTextHelpers();
    const options = getTextStylePresetOptions(TEXT_STYLE_PRESETS.find(preset => preset.id === 'yellowShadow'), 24);
    const textbox = helpers.createText('New title', 'left', options);
    assert.equal(textbox.shadow.color, '#000000');
    assert.equal(textbox.shadow.affectStroke, true);
    helpers.applyToolOptionsToSelection({ textShadowOffsetX: -3, textShadowColor: '#ff0000' });
    assert.equal(textbox.shadow.offsetX, -3);
    assert.equal(textbox.shadow.offsetY, options.textShadowOffsetY);
    assert.equal(textbox.shadow.color, '#ff0000');
    helpers.applyToolOptionsToSelection({ textShadowEnabled: false });
    assert.equal(textbox.shadow, null);
    helpers.applyToolOptionsToSelection(getTextStylePresetOptions(TEXT_STYLE_PRESETS.find(preset => preset.id === 'yellowOutline'), 24));
    assert.equal(textbox.shadow, null);
    assert.equal(textbox.strokeWidth, 2);
});

function drawingContext() {
    const glyphs = [], backgrounds = [], stack = [];
    const keys = ['shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'fillStyle', 'strokeStyle', 'font', 'direction'];
    const ctx = { shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
        direction: 'ltr', canvas: { setAttribute() {} },
        save() { stack.push(Object.fromEntries(keys.map(key => [key, this[key]]))); },
        restore() { Object.assign(this, stack.pop()); },
        translate() {}, rotate() {}, setLineDash() {}, beginPath() {}, closePath() {},
        fillRect(...args) { backgrounds.push({ args, fill: this.fillStyle }); },
        fillText(text, x, y) { glyphs.push({ text, x, y, color: this.fillStyle, shadow: this.shadowColor, blur: this.shadowBlur }); },
        strokeText() {},
    };
    return { ctx, glyphs, backgrounds };
}

test('templates apply only to selected characters, including shadows and backgrounds, and persist in history', async () => {
    const helpers = loadTextHelpers();
    const textbox = helpers.createText('前重点后', 'left');
    textbox.initDelayedCursor = () => {};
    textbox.isEditing = true;
    textbox.selectionStart = 1;
    textbox.selectionEnd = 3;
    helpers.setObjects([textbox]);
    const options = getTextStylePresetOptions(TEXT_STYLE_PRESETS.find(preset => preset.id === 'whiteShadow'), 24);
    helpers.applyToolOptionsToSelection(options);
    assert.equal(textbox.fill, '#000000');
    assert.equal(textbox.shadow, null);
    assert.equal(textbox.getStyleAtPosition(0, true).fill, '#000000');
    assert.equal(textbox.getStyleAtPosition(1, true).fill, '#ffffff');
    assert.equal(textbox.getStyleAtPosition(2, true).fontWeight, 'bold');
    assert.equal(textbox.getStyleAtPosition(3, true).fill, '#000000');
    assert.equal(getTextShadowOptions(textbox).textShadowEnabled, true);
    const drawn = drawingContext();
    textbox._render(drawn.ctx);
    const selected = drawn.glyphs.filter(glyph => glyph.color === '#ffffff');
    assert.deepEqual(selected.map(glyph => glyph.text), ['重', '点']);
    assert.ok(selected.every(glyph => glyph.shadow === '#000000' && glyph.blur > 0));
    assert.ok(drawn.glyphs.filter(glyph => glyph.color === '#000000').every(glyph => glyph.shadow === 'transparent'));
    for (const saved of [textbox.toObject(), helpers.getHistory().at(-1)[0]]) {
        const restored = await Textbox.fromObject(JSON.parse(JSON.stringify(saved)));
        installTextRangeRenderer(restored);
        const rendering = drawingContext();
        restored._render(rendering.ctx);
        assert.equal(restored.getStyleAtPosition(1, false)._textShadow.textShadowEnabled, true);
        assert.ok(rendering.glyphs.filter(glyph => glyph.color === '#ffffff').every(glyph => glyph.shadow === '#000000'));
    }
    helpers.applyToolOptionsToSelection(getTextStylePresetOptions(TEXT_STYLE_PRESETS.find(preset => preset.id === 'whiteOnRed'), 24));
    assert.equal(textbox.textBackgroundEnabled, undefined);
    assert.equal(textbox.getStyleAtPosition(1, false).textBackgroundColor, '#df2020');
    assert.equal(textbox.getStyleAtPosition(0, false).textBackgroundColor, undefined);
    assert.equal(textbox.getStyleAtPosition(1, false)._textShadow.textShadowEnabled, false);
    textbox.selectionEnd = textbox.selectionStart;
    helpers.applyToolOptionsToSelection(options);
    assert.equal(textbox.fill, '#ffffff');
    assert.equal(textbox.shadow.color, '#000000');
    assert.equal(textbox.getStyleAtPosition(1, false)._textShadow, undefined);
    assert.equal(textbox.getStyleAtPosition(1, false).textBackgroundColor, undefined);
});

test('pasting text with an empty background style retains the actual white-text shadow', () => {
    const helpers = loadTextHelpers();
    const textbox = helpers.createText('原文', 'left', getTextStylePresetOptions(TEXT_STYLE_PRESETS.find(preset => preset.id === 'whiteShadow'), 24));
    textbox.isEditing = true;
    textbox.initDelayedCursor = () => {};
    textbox.selectionStart = 0;
    textbox.selectionEnd = textbox._text.length;
    // Use Fabric's actual paste/input logic and its copied-character style payload.
    const env = require('fabric').getEnv();
    env.copyPasteData.copiedText = '粘贴文字';
    env.copyPasteData.copiedTextStyle = [...'粘贴文字'].map(() => ({ fill: '#ffffff', textBackgroundColor: '' }));
    textbox.hiddenTextarea = { value: '粘贴文字', selectionStart: 4, selectionEnd: 4, style: {} };
    textbox.paste();
    textbox.onInput({ stopPropagation() {} });
    assert.equal(textbox.text, '粘贴文字');
    const rendering = drawingContext();
    textbox._render(rendering.ctx);
    assert.ok(rendering.glyphs.length > 0);
    assert.ok(rendering.glyphs.every(glyph => glyph.shadow === '#000000' && glyph.blur > 0));
    env.copyPasteData.copiedText = undefined;
    env.copyPasteData.copiedTextStyle = undefined;
});

test('shadow-only ranges with identical fonts and fills stay separate after reload and retain measured positions', async () => {
    const helpers = loadTextHelpers();
    const textbox = helpers.createText('ABCD', 'left');
    textbox.isEditing = true;
    textbox.selectionStart = 1;
    textbox.selectionEnd = 2;
    textbox.initDelayedCursor = () => {};
    helpers.setObjects([textbox]);
    helpers.applyToolOptionsToSelection({ textShadowEnabled: true, textShadowColor: '#ff0000' });
    const saved = textbox.toObject();
    const restored = await Textbox.fromObject(JSON.parse(JSON.stringify(saved)));
    installTextRangeRenderer(restored);
    const rendering = drawingContext();
    restored._render(rendering.ctx);
    assert.deepEqual(rendering.glyphs.map(glyph => glyph.text), ['A', 'B', 'C', 'D']);
    assert.deepEqual(rendering.glyphs.map(glyph => glyph.shadow), ['transparent', '#ff0000', 'transparent', 'transparent']);
    assert.equal(restored.width, textbox.width);
    const positions = rendering.glyphs.map(glyph => glyph.x);
    assert.ok(positions.every((x, index) => index === 0 || x > positions[index - 1]));
});

test('selection settings reflect character styles and preserve the whole-box background when no inline background exists', () => {
    const textbox = new Textbox('文字', { fontSize: 24, fill: '#000000', textBackgroundEnabled: true });
    textbox.isEditing = true;
    textbox.selectionStart = 1;
    textbox.selectionEnd = 2;
    textbox.setSelectionStyles({ fill: '#ffffff', fontSize: 48, fontWeight: 'bold' });
    const options = getTextSelectionOptions(textbox);
    assert.equal(options.fill, '#ffffff');
    assert.equal(options.size, 48);
    assert.equal(options.bold, true);
    assert.equal(options.textBackgroundEnabled, undefined);
    textbox.setSelectionStyles({ textBackgroundColor: 'rgba(255, 0, 0, 0.5)' });
    assert.equal(getTextSelectionOptions(textbox).textBackgroundEnabled, true);
    assert.equal(getTextSelectionOptions(textbox).textBackgroundOpacity, 0.5);
    textbox.setSelectionStyles({ textBackgroundColor: '' });
    assert.equal(getTextSelectionOptions(textbox).textBackgroundEnabled, false);
    textbox.selectionEnd = textbox.selectionStart;
    assert.deepEqual(getTextSelectionOptions(textbox), {});
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
