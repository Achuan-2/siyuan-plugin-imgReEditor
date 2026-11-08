const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { Rect, Gradient } = require('fabric');

const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleFixture = { exports: {} };
new Function('module', 'exports', compile(readFileSync(
    resolve(__dirname, '../src/components/editor/canvasLayout.ts'), 'utf8'
)))(moduleFixture, moduleFixture.exports);
const helpers = moduleFixture.exports;
const { CANVAS_RATIOS, normalizeCanvasLayout, normalizeCanvasPresets, createMarginGuides, projectCanvasGuides } = helpers;
const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('canvas.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['getCanvasLayout', 'getToolOptions', 'updateGuideOverlay', 'restoreCanvasLayout',
    'setTool', 'resizeCanvas', 'setCanvasBackground', 'updateCanvasBackgroundSize',
    'pushHistory', 'pushInitialHistory', 'undo', 'redo', 'toJSON', 'fromJSON', 'applyToolOptionsToSelection']);
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name.text))
    .map(node => node.getText(parsed).replace(/^export\s+/, '')).join('\n');

class Background extends Rect {
    static type = 'canvas-background';
    _isCanvasBackground = true;
}

function editorFixture() {
    let objects = [new Background({ width: 800, height: 600, fill: '#ffffff', excludeFromExport: true }),
        new Rect({ left: 120, top: 90, width: 100, height: 60, fill: '#ff0000' })];
    const events = [];
    const canvas = {
        width: 1000, height: 800, viewportTransform: [0.5, 0, 0, 0.5, 30, 20],
        getWidth() { return this.width; }, getHeight() { return this.height; },
        getObjects: () => objects, getActiveObjects: () => objects.filter(o => !o._isCanvasBackground),
        add: o => objects.push(o), remove: o => { objects = objects.filter(obj => obj !== o); },
        sendObjectToBack() {},
        setDimensions({ width, height }) { this.width = width; this.height = height; },
        setViewportTransform(v) { this.viewportTransform = v; },
        toObject() { return { objects: objects.filter(o => !o.excludeFromExport).map(o => o.toObject()) }; },
        toJSON() { return this.toObject(); },
        async loadFromJSON(json) {
            objects = json.objects.map(({ type, ...options }) => new Rect(options));
        },
        requestRenderAll() {}, renderAll() {},
    };
    const imports = { ...helpers, canvas, Gradient, CanvasBackgroundRect: Background,
        dispatch: (name, detail) => events.push({ name, detail }), setTimeout: () => {},
        // Surface swallowed integration errors as test failures.
        console: { warn: (_, error) => { throw error; }, error: (_, error) => { throw error; } } };
    const api = new Function(...Object.keys(imports), compile(`
        const isCanvasMode = true, cropMode = false, isImageCropping = false, selectCanvasSizeMode = false;
        const container = { closest: () => ({ clientWidth: 1000, clientHeight: 800 }) };
        const HISTORY_PROPS = [], MAX_HISTORY = 50;
        let activeTool = null, activeToolOptions = {}, guideSegments = [], canvasLayoutState = normalizeCanvasLayout();
        let isHistoryProcessing = false, history = [], historyIndex = -1;
        let lastActionType = null, pendingActionType = null, lastPushTime = 0;
        const schedulePushWithType = type => { pendingActionType = type; };
        const notifyHistoryUpdate = () => {}, restoreObjectSelectionStates = () => {},
            updateCurrentNumberFromCanvas = () => {}, updateZoomDisplay = () => {}, fitImageToViewport = () => {},
            upgradeLegacyTextObjectsToTextboxes = async () => {};
        ${functions}
        pushInitialHistory();
        return { setTool, resizeCanvas, getCanvasLayout, getToolOptions, toJSON, fromJSON, undo, redo,
            applyToolOptionsToSelection,
            flush() { lastPushTime = 0; pushHistory(); pendingActionType = null; },
            overlay() { updateGuideOverlay(); return guideSegments; },
        };
    `))(...Object.values(imports));
    return { ...api, canvas, events };
}

test('16:10 dimensions and presets preserve layout without sharing mutable guide or gradient data', () => {
    const ratio = CANVAS_RATIOS.find(p => p.label === '16:10');
    assert.equal(Math.round(1920 / ratio.ratio), 1200);
    const original = { width: 1920, height: 1200, ratioLabel: '16:10', lockAspectRatio: true,
        fill: { type: 'linear', colorStops: [{ offset: 0, color: '#ffffff' }] }, guides: createMarginGuides(8) };
    const saved = normalizeCanvasPresets([{ id: 'cover', name: ' 封面 ', layout: original }])[0];
    original.guides[0].position = 45;
    original.fill.colorStops[0].color = '#ff0000';
    assert.equal(saved.name, '封面');
    assert.equal(saved.layout.ratioLabel, '16:10');
    assert.equal(saved.layout.guides[0].position, 8);
    assert.equal(saved.layout.fill.colorStops[0].color, '#ffffff');
    assert.equal(normalizeCanvasPresets([null, {}, saved, saved]).length, 1);
    assert.equal(normalizeCanvasLayout({ ...saved.layout, height: 1000 }).ratioLabel, '');
    assert.deepEqual(createMarginGuides(50), []);
});

test('guide positions follow logical bounds, resizing, zoom and pan, and can be hidden', () => {
    const layout = normalizeCanvasLayout({ guides: [{ axis: 'vertical', position: 10 }, { axis: 'horizontal', position: 90 }] });
    const viewport = [0.5, 0, 0, 0.5, 30, 20];
    assert.deepEqual(projectCanvasGuides(layout, { left: 60, top: 40, width: 800, height: 600 }, viewport), [
        { start: { x: 100, y: 40 }, end: { x: 100, y: 340 } },
        { start: { x: 60, y: 310 }, end: { x: 460, y: 310 } },
    ]);
    assert.deepEqual(projectCanvasGuides({ ...layout, guidesVisible: false }, { left: 0, top: 0, width: 1, height: 1 }, viewport), []);
    assert.deepEqual(normalizeCanvasLayout({ guides: [null, { axis: 'x', position: 1 }, { axis: 'vertical', position: -1 }] }).guides, []);
});

test('canvas layout survives serialization, reopening, tool switching and undo/redo without altering artwork', async () => {
    const editor = editorFixture();
    const artwork = editor.canvas.getActiveObjects()[0];
    const artworkBefore = artwork.toObject();
    const layout = normalizeCanvasLayout({ width: 1600, height: 1000, lockAspectRatio: true,
        ratioLabel: '16:10', fill: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)', guides: createMarginGuides(10) });
    editor.setTool('canvas', layout);
    editor.applyToolOptionsToSelection(layout);
    editor.resizeCanvas(layout.width, layout.height);
    editor.flush();
    assert.deepEqual(artwork.toObject(), artworkBefore);
    assert.equal(editor.overlay().length, 4);
    editor.setTool('hand');
    assert.equal(editor.overlay().length, 4);
    editor.setTool('canvas', editor.getCanvasLayout());
    assert.deepEqual(editor.getToolOptions(), layout);
    const saved = JSON.parse(JSON.stringify(await editor.toJSON()));
    assert.deepEqual(saved.canvasLayout, layout);
    assert.equal(saved.objects.length, 1); // Guides never become Fabric objects or export content.
    const reopened = editorFixture();
    await reopened.fromJSON(saved);
    assert.deepEqual(reopened.getCanvasLayout(), layout);
    assert.equal(reopened.overlay().length, 4);
    await editor.undo();
    assert.equal(editor.getCanvasLayout().width, 800);
    assert.equal(editor.overlay().length, 0);
    await editor.redo();
    assert.deepEqual(editor.getCanvasLayout(), layout);
    assert.equal(editor.overlay().length, 4);
    await reopened.fromJSON({ width: 640, height: 480, bgFill: '#123456', objects: saved.objects });
    assert.deepEqual(reopened.getCanvasLayout().guides, []);
    assert.equal(reopened.getCanvasLayout().fill, '#123456');
});

test('guide visibility and edits are restored together with background through history', async () => {
    const editor = editorFixture();
    editor.setTool('canvas', { guides: createMarginGuides(5) });
    editor.flush();
    editor.setTool('canvas', { guidesVisible: false, fill: 'transparent' });
    editor.flush();
    assert.equal(editor.overlay().length, 0);
    await editor.undo();
    assert.equal(editor.overlay().length, 4);
    assert.equal(editor.getCanvasLayout().fill, '#ffffff');
    await editor.redo();
    assert.equal(editor.overlay().length, 0);
    assert.equal(editor.getCanvasLayout().fill, 'transparent');
});

function layoutControlFixture(initialSettings, initialPresets = []) {
    const component = readFileSync(resolve(__dirname, '../src/components/editor/CanvasLayoutSettings.svelte'), 'utf8')
        .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const parsed = ts.createSourceFile('controls.ts', component, ts.ScriptTarget.Latest, true);
    const functions = parsed.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(parsed)).join('\n');
    const events = [];
    const imports = { ...helpers, dispatch: (name, detail) => events.push({ name, detail }), generateId: () => 'saved-cover' };
    const api = new Function(...Object.keys(imports), compile(`
        let settings, entries, guides, selected = '', name = '', margin = 10;
        ${functions}
        return { load, deletePreset, addMargins, changePosition,
            configure(nextSettings, nextPresets) {
                settings = nextSettings;
                entries = normalizeCanvasPresets(nextPresets);
                guides = normalizeCanvasLayout(settings).guides;
            },
            saveAs(value) { name = value; save(); },
            select(id) { selected = id; },
        };
    `))(...Object.values(imports));
    api.configure(initialSettings, initialPresets);
    return { ...api, events };
}

test('preset controls save, reload, replace same-name presets and delete without changing the applied layout', () => {
    const layout = normalizeCanvasLayout({ width: 1920, height: 1200, ratioLabel: '16:10', lockAspectRatio: true,
        fill: '#123456', guides: createMarginGuides(10), guidesVisible: false });
    const first = layoutControlFixture(layout);
    first.saveAs('');
    assert.equal(first.events.length, 0);
    first.saveAs(' B站封面 ');
    const stored = JSON.parse(JSON.stringify(first.events.at(-1).detail));
    assert.equal(stored[0].name, 'B站封面');
    const reopened = layoutControlFixture({}, stored);
    reopened.select(stored[0].id);
    reopened.load();
    assert.deepEqual(reopened.events.at(-1), { name: 'loadPreset', detail: layout });
    const replacement = { ...layout, fill: 'transparent' };
    reopened.configure(replacement, stored);
    reopened.saveAs('B站封面');
    const replaced = reopened.events.at(-1).detail;
    assert.equal(replaced.length, 1);
    assert.equal(replaced[0].id, stored[0].id);
    assert.equal(replaced[0].layout.fill, 'transparent');
    reopened.configure(replacement, replaced);
    reopened.deletePreset();
    assert.deepEqual(reopened.events.at(-1), { name: 'updatePresets', detail: [] });
    assert.equal(replacement.fill, 'transparent');
});

test('margin guide controls avoid duplicates and reject invalid position input', () => {
    const control = layoutControlFixture({ guides: createMarginGuides(10) });
    control.addMargins();
    assert.equal(control.events.at(-1).detail.guides.length, 4);
    const invalid = { value: '-2', validity: { valid: false } };
    const count = control.events.length;
    control.changePosition(0, { currentTarget: invalid });
    assert.equal(control.events.length, count);
    assert.equal(invalid.value, '10');
    control.changePosition(0, { currentTarget: { value: '12.5', validity: { valid: true } } });
    assert.equal(control.events.at(-1).detail.guides[0].position, 12.5);
});
