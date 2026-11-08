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
const { CANVAS_RATIOS, normalizeCanvasLayout, normalizeCanvasPresets, projectCanvasGuides } = helpers;
const guideFixture = (offset = 10) => [
    { axis: 'horizontal', position: offset }, { axis: 'horizontal', position: 100 - offset },
    { axis: 'vertical', position: offset }, { axis: 'vertical', position: 100 - offset },
];
const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('canvas.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['getCanvasLayout', 'getToolOptions', 'updateGuideOverlay', 'restoreCanvasLayout',
    'setTool', 'resizeCanvas', 'setCanvasBackground', 'updateCanvasBackgroundSize',
    'pushHistory', 'pushInitialHistory', 'undo', 'redo', 'toJSON', 'fromJSON', 'applyToolOptionsToSelection',
    'guidePositionFromEvent', 'startGuideDrag', 'setDraggedGuidePosition', 'moveGuideDrag', 'releaseGuideDrag',
    'finishGuideDrag', 'cancelGuideDrag', 'cancelGuidePointer', 'handleGuideDragKeydown']);
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
    const captures = new Set();
    const listeners = new Map();
    const overlayElement = {
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 500, height: 400 }),
        setPointerCapture: id => captures.add(id),
        hasPointerCapture: id => captures.has(id),
        releasePointerCapture: id => captures.delete(id),
    };
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
    const imports = { ...helpers, canvas, Gradient, CanvasBackgroundRect: Background, overlayElement,
        window: { addEventListener: (type, listener) => listeners.set(type, listener),
            removeEventListener: type => listeners.delete(type) },
        dispatch: (name, detail) => events.push({ name, detail }), setTimeout: () => {},
        // Surface swallowed integration errors as test failures.
        console: { warn: (_, error) => { throw error; }, error: (_, error) => { throw error; } } };
    const api = new Function(...Object.keys(imports), compile(`
        const isCanvasMode = true, cropMode = false, isImageCropping = false, selectCanvasSizeMode = false;
        const container = { closest: () => ({ clientWidth: 1000, clientHeight: 800 }) };
        const HISTORY_PROPS = [], MAX_HISTORY = 50;
        let activeTool = null, activeToolOptions = {}, guideSegments = [], canvasLayoutState = normalizeCanvasLayout();
        let guideDrag = null, guideOverlay = overlayElement;
        let isHistoryProcessing = false, history = [], historyIndex = -1;
        let lastActionType = null, pendingActionType = null, lastPushTime = 0;
        const schedulePushWithType = type => { pendingActionType = type; };
        const notifyHistoryUpdate = () => {}, restoreObjectSelectionStates = () => {},
            updateCurrentNumberFromCanvas = () => {}, updateZoomDisplay = () => {}, fitImageToViewport = () => {},
            upgradeLegacyTextObjectsToTextboxes = async () => {};
        ${functions}
        pushInitialHistory();
        return { setTool, resizeCanvas, getCanvasLayout, getToolOptions, toJSON, fromJSON, undo, redo,
            applyToolOptionsToSelection, startGuideDrag, moveGuideDrag, finishGuideDrag, cancelGuidePointer,
            cancelGuideDrag, handleGuideDragKeydown,
            getDragging: () => guideDrag,
            flush() { lastPushTime = 0; pushHistory(); pendingActionType = null; },
            overlay() { updateGuideOverlay(); return guideSegments; },
        };
    `))(...Object.values(imports));
    return { ...api, canvas, events, captures, listeners,
        pointer(axis, position, pointerId = 1, button = 0) {
            const bounds = canvas.getObjects().find(o => o._isCanvasBackground);
            const x = bounds.left + bounds.width * (axis === 'vertical' ? position : 50) / 100;
            const y = bounds.top + bounds.height * (axis === 'horizontal' ? position : 50) / 100;
            const [a, b, c, d, e, f] = canvas.viewportTransform;
            return { pointerId, button, isPrimary: true,
                clientX: 100 + (a * x + c * y + e) / 2,
                clientY: 50 + (b * x + d * y + f) / 2,
                preventDefault() {}, stopPropagation() {},
            };
        },
    };
}

test('16:10 dimensions and presets preserve layout without sharing mutable guide or gradient data', () => {
    const ratio = CANVAS_RATIOS.find(p => p.label === '16:10');
    assert.equal(Math.round(1920 / ratio.ratio), 1200);
    const original = { width: 1920, height: 1200, ratioLabel: '16:10', lockAspectRatio: true,
        fill: { type: 'linear', colorStops: [{ offset: 0, color: '#ffffff' }] }, guides: guideFixture(8) };
    const saved = normalizeCanvasPresets([{ id: 'cover', name: ' 封面 ', layout: original }])[0];
    original.guides[0].position = 45;
    original.fill.colorStops[0].color = '#ff0000';
    assert.equal(saved.name, '封面');
    assert.equal(saved.layout.ratioLabel, '16:10');
    assert.equal(saved.layout.guides[0].position, 8);
    assert.equal(saved.layout.fill.colorStops[0].color, '#ffffff');
    assert.equal(normalizeCanvasPresets([null, {}, saved, saved]).length, 1);
    assert.equal(normalizeCanvasLayout({ ...saved.layout, height: 1000 }).ratioLabel, '');
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
        ratioLabel: '16:10', fill: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)', guides: guideFixture(10) });
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
    editor.setTool('canvas', { guides: guideFixture(5) });
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
        let settings, entries, guides, selected = '', name = '';
        ${functions}
        return { load, deletePreset, changePosition,
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
        fill: '#123456', guides: guideFixture(10), guidesVisible: false });
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

test('guide controls reject invalid position input', () => {
    const control = layoutControlFixture({ guides: guideFixture(10) });
    const invalid = { value: '-2', validity: { valid: false } };
    const count = control.events.length;
    control.changePosition(0, { currentTarget: invalid });
    assert.equal(control.events.length, count);
    assert.equal(invalid.value, '10');
    control.changePosition(0, { currentTarget: { value: '12.5', validity: { valid: true } } });
    assert.equal(control.events.at(-1).detail.guides[0].position, 12.5);
});

test('direct guide dragging preserves the grab offset, follows the viewport and commits one undo step', async () => {
    const editor = editorFixture();
    editor.setTool('canvas', { guides: guideFixture(10) });
    editor.flush();
    const artwork = editor.canvas.getActiveObjects()[0].toObject();
    // Start 0.6% away from the visible vertical line, inside its wider hit area.
    editor.startGuideDrag(2, editor.pointer('vertical', 10.6));
    assert.equal(editor.captures.size, 1);
    editor.moveGuideDrag(editor.pointer('vertical', 20.6));
    editor.moveGuideDrag(editor.pointer('vertical', 25.6));
    assert.equal(editor.getCanvasLayout().guides[2].position, 25);
    assert.equal(editor.events.filter(e => e.name === 'canvasGuidesChanged').length, 0);
    editor.finishGuideDrag(editor.pointer('vertical', 30.6));
    assert.equal(editor.getCanvasLayout().guides[2].position, 30);
    assert.equal(editor.events.filter(e => e.name === 'canvasGuidesChanged').length, 1);
    assert.equal(editor.listeners.size, 0);
    assert.equal(editor.captures.size, 0);
    assert.deepEqual(editor.canvas.getActiveObjects()[0].toObject(), artwork);
    await editor.undo();
    assert.equal(editor.getCanvasLayout().guides[2].position, 10);
    await editor.redo();
    assert.equal(editor.getCanvasLayout().guides[2].position, 30);
    const saved = await editor.toJSON();
    assert.equal(saved.canvasLayout.guides[2].position, 30);
    assert.equal(saved.objects.length, 1);
});

test('consecutive drags have separate undo steps and horizontal dragging clamps to the canvas edges', async () => {
    const editor = editorFixture();
    editor.setTool('canvas', { guides: guideFixture(10) });
    // Deliberately leave the earlier edit pending when starting the first drag.
    editor.startGuideDrag(0, editor.pointer('horizontal', 10));
    editor.moveGuideDrag(editor.pointer('horizontal', -30));
    assert.equal(editor.getCanvasLayout().guides[0].position, 0);
    editor.finishGuideDrag(editor.pointer('horizontal', 20));
    editor.startGuideDrag(0, editor.pointer('horizontal', 20));
    editor.finishGuideDrag(editor.pointer('horizontal', 130));
    assert.equal(editor.getCanvasLayout().guides[0].position, 100);
    await editor.undo();
    assert.equal(editor.getCanvasLayout().guides[0].position, 20);
    await editor.undo();
    assert.equal(editor.getCanvasLayout().guides[0].position, 10);
});

test('Escape, pointer cancellation and focus loss restore the original position and release capture', () => {
    for (const cancel of [
        editor => editor.handleGuideDragKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }),
        editor => editor.cancelGuidePointer({ pointerId: 1 }),
        editor => editor.listeners.get('blur')(),
    ]) {
        const editor = editorFixture();
        editor.setTool('canvas', { guides: guideFixture(10) });
        editor.flush();
        editor.startGuideDrag(0, editor.pointer('horizontal', 10));
        editor.moveGuideDrag(editor.pointer('horizontal', 40));
        assert.equal(editor.getCanvasLayout().guides[0].position, 40);
        cancel(editor);
        assert.equal(editor.getCanvasLayout().guides[0].position, 10);
        assert.equal(editor.getDragging(), null);
        assert.equal(editor.captures.size, 0);
        assert.equal(editor.listeners.size, 0);
        assert.equal(editor.events.filter(e => e.name === 'canvasGuidesChanged').length, 0);
    }
});

test('a click does not round or commit a guide, and unrelated pointers and right clicks cannot move it', () => {
    const editor = editorFixture();
    editor.setTool('canvas', { guides: [{ axis: 'vertical', position: 33.333 }] });
    editor.flush();
    editor.startGuideDrag(0, editor.pointer('vertical', 33.333, 2, 2));
    assert.equal(editor.getDragging(), null);
    editor.startGuideDrag(0, editor.pointer('vertical', 33.333));
    editor.moveGuideDrag(editor.pointer('vertical', 80, 2));
    editor.finishGuideDrag(editor.pointer('vertical', 80, 2));
    editor.cancelGuidePointer({ pointerId: 2 });
    assert.ok(editor.getDragging());
    editor.finishGuideDrag(editor.pointer('vertical', 33.333));
    assert.equal(editor.getCanvasLayout().guides[0].position, 33.333);
    assert.equal(editor.events.filter(e => e.name === 'canvasGuidesChanged').length, 0);
});

test('pointer-to-guide conversion inverts transformed viewports and rejects singular matrices', () => {
    const bounds = { left: 60, top: 40, width: 800, height: 600 };
    const layout = normalizeCanvasLayout({ guides: [{ axis: 'vertical', position: 27.5 }, { axis: 'horizontal', position: 63 }] });
    const viewport = [0.8, 0.2, -0.1, 0.9, 35, -12];
    const segments = projectCanvasGuides(layout, bounds, viewport);
    segments.forEach((segment, index) => {
        const position = helpers.canvasGuidePositionAtPoint(layout.guides[index].axis, segment.start, bounds, viewport);
        assert.ok(Math.abs(position - layout.guides[index].position) < 1e-8);
    });
    assert.equal(helpers.canvasGuidePositionAtPoint('vertical', { x: 1, y: 2 }, bounds, [0, 0, 0, 0, 0, 0]), null);
});
