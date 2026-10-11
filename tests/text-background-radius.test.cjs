const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { Textbox, FabricObject, setEnv } = require('fabric');

const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helperModule = { exports: {} };
new Function('module', 'exports', compile(readFileSync(
    resolve(__dirname, '../src/components/editor/textBackgroundRadius.ts'), 'utf8'
)))(helperModule, helperModule.exports);
const { getTextBackgroundRadiusPercent, getTextBackgroundPixelRadius,
    normalizeTextBackgroundRadiusPercent } = helperModule.exports;

setEnv({
    document: { createElement: () => ({ getContext: () => ({ measureText: text => ({ width: [...text].length * 100 }) }) }) },
    window: { devicePixelRatio: 1 }, isTouchSupported: false,
    WebGLProbe: {}, copyPasteData: {}, dispose() {},
});

// Run the editor's actual normalization, rendering path and serialization declarations.
const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('CanvasEditor.ts', source, ts.ScriptTarget.Latest, true);
const names = ['clampNumber', 'getTextBackgroundOptions', 'isTransparentColor',
    'drawRoundRectPath', 'drawTextBackground', 'normalizeTextStrokeWidth',
    'getTextStrokeOptions', 'applyTextRenderingOptions'];
const functions = parsed.statements
    .filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text))
    .map(node => node.getText(parsed)).join('\n');
const editor = new Function('getTextBackgroundRadiusPercent', 'getTextBackgroundPixelRadius', compile(`
    const MAX_TEXT_STROKE_WIDTH = 20;
    // These tests render opaque colors and test the background path without a browser.
    const colorWithOpacity = color => color;
    function applyTextBackgroundRenderer() {}
    ${functions}
    return { getTextBackgroundOptions, drawTextBackground, applyTextRenderingOptions };
`))(getTextBackgroundRadiusPercent, getTextBackgroundPixelRadius);

test('percentage rounding follows background size, including padding and multiline height', () => {
    const options = { width: 200, height: 80, textBackgroundPadding: 10, textBackgroundRadiusPercent: 50 };
    assert.equal(getTextBackgroundPixelRadius(options), 25);
    assert.equal(getTextBackgroundPixelRadius({ ...options, width: 400, height: 160, textBackgroundPadding: 20 }), 50);
    assert.equal(getTextBackgroundPixelRadius({ ...options, height: 140 }), 40);
    assert.equal(getTextBackgroundPixelRadius({ ...options, textBackgroundRadiusPercent: 100 }), 50);
    assert.equal(getTextBackgroundPixelRadius({ ...options, textBackgroundRadiusPercent: 0 }), 0);
    assert.equal(normalizeTextBackgroundRadiusPercent(-20), 0);
    assert.equal(normalizeTextBackgroundRadiusPercent(150), 100);
    assert.equal(normalizeTextBackgroundRadiusPercent(NaN), 20);
});

test('legacy pixels convert when dimensions exist and preserve their appearance', () => {
    assert.equal(getTextBackgroundRadiusPercent({ textBackgroundRadius: 4 }), undefined);
    const text = new Textbox('Legacy title', {
        width: 200, fontSize: 24, textBackgroundEnabled: true,
        textBackgroundRadius: 4, textBackgroundPadding: 6,
    });
    const expected = getTextBackgroundRadiusPercent(text);
    assert.equal(getTextBackgroundPixelRadius(text), 4);
    editor.applyTextRenderingOptions(text);
    assert.equal(text.textBackgroundRadiusPercent, expected);
    assert.equal(getTextBackgroundPixelRadius(text), 4);
    text.set('fontSize', 48);
    text.initDimensions();
    assert.ok(getTextBackgroundPixelRadius(text) > 4);
    assert.equal(getTextBackgroundRadiusPercent(text), expected);
});

test('the canvas renderer uses percentage radii for both the fill and border', () => {
    const paths = [];
    const ctx = {
        save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {},
        roundRect: (...args) => paths.push(args),
    };
    editor.drawTextBackground(ctx, {
        width: 200, height: 80, textBackgroundEnabled: true,
        textBackgroundFill: '#ff0000', textBackgroundOpacity: 1,
        textBackgroundPadding: 10, textBackgroundRadiusPercent: 100,
        textBackgroundStrokeEnabled: true, textBackgroundStroke: '#000000',
    });
    assert.deepEqual(paths, [[-110, -50, 220, 100, 50], [-109.5, -49.5, 219, 99, 49.5]]);
    assert.equal(ctx.fillStyle, '#ff0000');
    assert.equal(ctx.strokeStyle, '#000000');
});

test('project and undo snapshots preserve percentages and retain editable text', async () => {
    const customProperties = source.match(/\(FabricObject as any\)\.customProperties = \[[\s\S]*?\];/)[0];
    const historyProperties = source.match(/const HISTORY_PROPS = \[[\s\S]*?\];/)[0];
    const previous = FabricObject.customProperties;
    try {
        new Function('FabricObject', compile(customProperties))(FabricObject);
        const historyProps = new Function(compile(historyProperties) + '\nreturn HISTORY_PROPS;')();
        const text = new Textbox('Cover title', {
            width: 200, fontSize: 24, textBackgroundEnabled: true,
            textBackgroundPadding: 8, textBackgroundRadiusPercent: 75,
        });
        for (const saved of [text.toObject(), text.toObject(historyProps)]) {
            assert.equal(saved.textBackgroundRadiusPercent, 75);
            const restored = await Textbox.fromObject(saved);
            assert.equal(editor.getTextBackgroundOptions(restored).textBackgroundRadiusPercent, 75);
            assert.equal(getTextBackgroundPixelRadius(restored), getTextBackgroundPixelRadius(text));
            restored.set({ text: 'Editable\nMultiline title', fontSize: 48 });
            restored.initDimensions();
            assert.equal(getTextBackgroundRadiusPercent(restored), 75);
            assert.ok(getTextBackgroundPixelRadius(restored) > getTextBackgroundPixelRadius(text));
        }
    } finally {
        FabricObject.customProperties = previous;
    }
});
