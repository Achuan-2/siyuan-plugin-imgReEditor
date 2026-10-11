const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Rect, FabricObject } = require('fabric');
const ts = require('typescript');

const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleSource = readFileSync(resolve(__dirname, '../src/components/editor/rectangleCornerRadius.ts'), 'utf8');
const helperModule = { exports: {} };
new Function('module', 'exports', compile(moduleSource))(helperModule, helperModule.exports);
const { applyRectangleCornerRadius, getRectangleCornerRadiusPercent,
    normalizeRectangleCornerRadiusPercent } = helperModule.exports;

test('percentages are bounded to 0–100 and invalid values default to zero', () => {
    assert.equal(normalizeRectangleCornerRadiusPercent(-1), 0);
    assert.equal(normalizeRectangleCornerRadiusPercent(150), 100);
    assert.equal(normalizeRectangleCornerRadiusPercent('25'), 25);
    assert.equal(normalizeRectangleCornerRadiusPercent(NaN), 0);
    assert.equal(normalizeRectangleCornerRadiusPercent(undefined), 0);
});

test('rounding follows the short side as a zero-sized rectangle is drawn and resized', () => {
    const rect = new Rect({ width: 0, height: 0 });
    applyRectangleCornerRadius(rect, 50);
    assert.equal(rect.rx, 0);
    rect.set({ width: 200, height: 100 });
    applyRectangleCornerRadius(rect);
    assert.equal(rect.rx, 25);
    assert.equal(rect.ry, 25);
    rect.set({ width: 100, height: 200 });
    applyRectangleCornerRadius(rect);
    assert.equal(rect.rx, 25);
    rect.set({ width: 400, height: 200 });
    applyRectangleCornerRadius(rect);
    assert.equal(rect.rx, 50);
    assert.equal(getRectangleCornerRadiusPercent(rect), 50);
});

test('independent X/Y scaling retains circular visible corners at the chosen percentage', () => {
    const rect = new Rect({ width: 100, height: 80 });
    applyRectangleCornerRadius(rect, 100);
    rect.set({ scaleX: 2, scaleY: 0.5 });
    applyRectangleCornerRadius(rect);
    assert.equal(rect.rx * rect.scaleX, 20);
    assert.equal(rect.ry * rect.scaleY, 20);
    assert.equal(getRectangleCornerRadiusPercent(rect), 100);
    applyRectangleCornerRadius(rect, 0);
    assert.equal(rect.rx, 0);
    assert.equal(rect.ry, 0);
});

test('legacy pixel radii can be read as percentages without changing the saved appearance', () => {
    const rect = new Rect({ width: 200, height: 100, rx: 10, ry: 10 });
    assert.equal(getRectangleCornerRadiusPercent(rect), 20);
    assert.equal(rect.rx, 10);
    assert.equal(rect.ry, 10);
    applyRectangleCornerRadius(rect);
    rect.set({ scaleX: 2, scaleY: 2 });
    applyRectangleCornerRadius(rect);
    assert.equal(getRectangleCornerRadiusPercent(rect), 20);
    assert.equal(rect.rx * rect.scaleX, 20);
});

test('editor serialization and history preserve percentages across restore and subsequent resize', async () => {
    const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8');
    const customProperties = source.match(/\(FabricObject as any\)\.customProperties = \[[\s\S]*?\];/)[0];
    const historyProperties = source.match(/const HISTORY_PROPS = \[[\s\S]*?\];/)[0];
    const previous = FabricObject.customProperties;
    try {
        new Function('FabricObject', compile(customProperties))(FabricObject);
        const historyProps = new Function(compile(historyProperties) + '\nreturn HISTORY_PROPS;')();
        const rect = new Rect({ width: 120, height: 80 });
        applyRectangleCornerRadius(rect, 75);
        const project = rect.toObject();
        const history = rect.toObject(historyProps);
        assert.equal(project._rectCornerRadiusPercent, 75);
        assert.equal(history._rectCornerRadiusPercent, 75);
        for (const saved of [project, history]) {
            const restored = await Rect.fromObject(saved);
            assert.equal(getRectangleCornerRadiusPercent(restored), 75);
            restored.set({ width: 240, height: 160 });
            applyRectangleCornerRadius(restored);
            assert.equal(restored.rx, 60);
            assert.equal(restored.ry, 60);
        }
    } finally {
        FabricObject.customProperties = previous;
    }
});
