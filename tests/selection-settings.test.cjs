const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const fabric = require('fabric');
fabric.setEnv({
    document: { createElement: () => ({ getContext: () => ({ measureText: text => ({ width: [...text].length * 200 }) }) }) },
    window: { devicePixelRatio: 1 }, isTouchSupported: false,
    WebGLProbe: {}, copyPasteData: {}, dispose() {},
});

const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const modules = new Map();
function loadHelper(name) {
    if (modules.has(name)) return modules.get(name);
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compile(readFileSync(
        resolve(__dirname, `../src/components/editor/${name}.ts`), 'utf8'
    )))(path => path.startsWith('./') ? loadHelper(path.slice(2)) : require(path), module, module.exports);
    modules.set(name, module.exports);
    return module.exports;
}
const selection = loadHelper('selectionSettings');
const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('CanvasEditor.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['dispatchSelection', 'handleSelectionChangeWithType',
    'normalizeTextResizeMode', 'getTextResizeMode', 'getTextDisplayFontSize',
    'normalizeTextStrokeWidth', 'getTextBackgroundOptions', 'clampNumber',
    'applyToolOptionsToSelection', 'colorWithOpacity', 'hexToRgb']);
const functions = [];
function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) functions.push(node.getText(parsed).replace(/^export\s+/, ''));
    ts.forEachChild(node, visit);
}
visit(parsed);

function loadSelectionEvents() {
    let active;
    const events = [];
    const canvas = {
        getActiveObject: () => active,
        getActiveObjects: () => !active ? [] : active instanceof fabric.ActiveSelection ? active.getObjects() : [active],
        requestRenderAll() {},
    };
    const imports = { ...selection, ...loadHelper('textStylePresets'), ...loadHelper('textRangeStyles'),
        ...loadHelper('textBackgroundRadius'), ...loadHelper('rectangleCornerRadius'),
        ...loadHelper('imageCornerRadius'), Color: fabric.Color };
    const handler = new Function(...Object.keys(imports), 'canvas', 'dispatch', compile(`
        const selectionTracker = createSelectionTracker();
        const activeTool = 'select';
        const schedulePushWithType = () => {};
        const DEFAULT_TEXT_RESIZE_MODE = 'layout', MAX_TEXT_STROKE_WIDTH = 20;
        const activeToolOptions = { textResizeMode: 'layout' };
        const tempArrow = null, tempMosaic = null, tempMagnifier = null, tempShape = null;
        const isDrawingMosaic = false, isDrawingMagnifier = false, isDrawingShape = false;
        ${functions.join('\n').replace(/catch \(e\) \{\}/g, 'catch (e) { throw e; }')}
        return { handleSelectionChangeWithType, applyToolOptionsToSelection };
    `))(...Object.values(imports), canvas, (name, detail) => events.push({ name, detail }));
    return {
        select(...objects) {
            if (active instanceof fabric.ActiveSelection) active.removeAll();
            active = objects.length > 1 ? new fabric.ActiveSelection(objects) : objects[0];
            handler.handleSelectionChangeWithType();
            return events.at(-1).detail;
        },
        apply: handler.applyToolOptionsToSelection,
        setActive: value => { active = value; },
    };
}

test('same-category multi-selection exposes editable settings and mixed types retain alignment metadata', () => {
    const editor = loadSelectionEvents();
    const textA = new fabric.Textbox('first', { fontFamily: 'Arial', fontSize: 24, fill: '#ffffff' });
    const textB = new fabric.IText('second', { fontFamily: 'Arial', fontSize: 24, fill: '#ffffff' });
    const rect = new fabric.Rect({ width: 100, height: 50, fill: '#ff0000' });
    let detail = editor.select(textA, textB);
    assert.equal(detail.type, 'text');
    assert.equal(detail.options.selectionType, 'text');
    assert.equal(detail.options.isSelection, true);
    assert.equal(detail.options.selectionCount, 2);
    assert.equal(detail.options.family, 'Arial');
    detail = editor.select(rect, new fabric.Rect({ width: 40, height: 20 }));
    assert.equal(detail.options.selectionType, 'rect');
    assert.equal(detail.options.fill, '#ff0000');
    detail = editor.select(textA, rect);
    assert.equal(detail.options.isMixedSelection, true);
    assert.equal(detail.options.isSelection, false);
    assert.equal(detail.options.selectionCount, 2);
});

test('selection identity changes reset panels even within a category; style refreshes and member order retain identity', () => {
    const editor = loadSelectionEvents();
    const first = new fabric.Rect({ width: 100, height: 50 });
    const second = new fabric.Rect({ width: 100, height: 50 });
    const third = new fabric.Rect({ width: 100, height: 50 });
    const single = editor.select(first).selectionRevision;
    first.set('fill', '#ff0000');
    assert.equal(editor.select(first).selectionRevision, single);
    const next = editor.select(second).selectionRevision;
    assert.ok(next > single);
    const multiple = editor.select(first, second).selectionRevision;
    assert.equal(editor.select(second, first).selectionRevision, multiple);
    assert.ok(editor.select(first, third).selectionRevision > multiple);
    const cleared = editor.select();
    assert.equal(cleared.options, null);
    assert.equal(cleared.selectionCount, 0);
});

test('selection settings activate locally and reset only on membership changes or leaving the selection tool', () => {
    const component = readFileSync(resolve(__dirname, '../src/components/editor/ToolSettings.svelte'), 'utf8');
    const script = component.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const reset = script.match(/\$: if \(tool !== 'select'[\s\S]*?^    \}/m)[0].replace('$: ', '');
    const choose = component.match(/on:click=\{(\(\) => selectionPanelTool = getSelectionTool\([^}]+)\}/)[1];
    const align = component.match(/on:click=\{(\(\) => selectionPanelTool = 'align')\}/)[1];
    const panel = new Function('getSelectionTool', compile(`
        let tool = 'select', settings = {}, selectionPanelTool = null, selectionPanelRevision;
        return {
            update(value, nextTool = tool) { settings = value; tool = nextTool; ${reset} },
            choose: ${choose}, align: ${align},
            state: () => ({ tool, selectionPanelTool }),
        };
    `))(selection.getSelectionTool);
    panel.update({ selectionType: 'text', selectionRevision: 1 });
    panel.choose();
    assert.deepEqual(panel.state(), { tool: 'select', selectionPanelTool: 'text' });
    panel.update({ selectionType: 'text', selectionRevision: 1, fill: '#ffffff' });
    assert.equal(panel.state().selectionPanelTool, 'text');
    panel.align();
    assert.deepEqual(panel.state(), { tool: 'select', selectionPanelTool: 'align' });
    panel.update({ selectionType: 'text', selectionRevision: 2 });
    assert.equal(panel.state().selectionPanelTool, null);
    panel.choose();
    panel.update({ selectionType: 'text', selectionRevision: 2 }, 'shape');
    assert.equal(panel.state().selectionPanelTool, null);
});

test('batch shape edits update every selected object and refresh native selection bounds while preserving world positions', () => {
    const editor = loadSelectionEvents();
    const first = new fabric.Rect({ left: 0, top: 0, width: 100, height: 50 });
    const second = new fabric.Rect({ left: 200, top: 100, width: 100, height: 50 });
    const active = new fabric.ActiveSelection([first, second]);
    editor.setActive(active);
    const positions = [first, second].map(object => object.getXY());
    const previousWidth = active.width;
    editor.apply({ fill: '#ff0000', strokeWidth: 8, cornerRadiusPercent: 50 });
    for (const object of [first, second]) {
        assert.equal(new fabric.Color(object.fill).toHex(), 'FF0000');
        assert.equal(object.strokeWidth, 8);
        assert.equal(object.rx, 12.5);
    }
    assert.ok(active.width > previousWidth);
    assert.deepEqual([first, second].map(object => object.getXY()), positions);
});

test('the parent keeps the selection tool during edits and clears stale settings after deselection', async () => {
    const parent = readFileSync(resolve(__dirname, '../src/components/ImageEditor.svelte'), 'utf8');
    const selectionHandler = parent.slice(parent.indexOf('on:selection={') + 'on:selection={'.length,
        parent.indexOf('on:historyUpdate=')).trim().slice(0, -1);
    const changeHandler = parent.match(/on:change=\{(e => \{[\s\S]*?\n\s*\})\}/)[1];
    const calls = [];
    const ref = {
        getToolOptions: () => ({ isSelection: true, selectionRevision: 1 }),
        setTool: (...args) => calls.push(['tool', ...args]),
        applyToolOptionsToSelection: options => calls.push(['edit', options]),
    };
    const handlers = new Function('canvasEditorRef', `
        let activeTool = 'select', activeShape = null, toolSettings = {};
        const saveToolSettings = () => {};
        return { selection: (${selectionHandler}), change: (${changeHandler}),
            state: () => ({ activeTool, toolSettings }) };
    `)(ref);
    await handlers.selection({ detail: { type: 'text', options: {
        isSelection: true, selectionType: 'text', selectionCount: 1, selectionRevision: 1, family: 'Arial',
    } } });
    handlers.change({ detail: { fill: '#ff0000' } });
    assert.equal(handlers.state().activeTool, 'select');
    assert.equal(calls[0][1], 'select');
    assert.deepEqual(calls[1], ['edit', { fill: '#ff0000' }]);
    await handlers.selection({ detail: { type: null, options: null, selectionRevision: 2, selectionCount: 0 } });
    assert.equal(handlers.state().toolSettings.isSelection, false);
    assert.equal(handlers.state().toolSettings.selectionRevision, 2);
});

test('multi-selecting from the image tool switches to selection for both images and mixed objects without changing selection', async () => {
    const parent = readFileSync(resolve(__dirname, '../src/components/ImageEditor.svelte'), 'utf8');
    const selectionHandler = parent.slice(parent.indexOf('on:selection={') + 'on:selection={'.length,
        parent.indexOf('on:historyUpdate=')).trim().slice(0, -1);
    for (const mixed of [false, true]) {
        const events = loadSelectionEvents();
        const createImage = () => new fabric.FabricImage({ width: 100, height: 60,
            classList: { add() {}, remove() {} } });
        const image = createImage();
        const other = mixed ? new fabric.Rect({ left: 200, top: 100, width: 50, height: 30 }) : createImage();
        const calls = [];
        const ref = { setTool: (...args) => calls.push(args) };
        const handler = new Function('canvasEditorRef', `
            let activeTool = 'image', activeShape = null, toolSettings = {};
            const saveToolSettings = () => {};
            return { select: (${selectionHandler}), state: () => ({ activeTool, toolSettings }) };
        `)(ref);
        await handler.select({ detail: events.select(image) });
        assert.equal(handler.state().activeTool, 'image');
        calls.length = 0;
        const detail = events.select(image, other);
        const active = image.group;
        const positions = [image, other].map(object => object.getXY());
        await handler.select({ detail });
        assert.equal(handler.state().activeTool, 'select');
        assert.equal(handler.state().toolSettings.selectionCount, 2);
        assert.equal(handler.state().toolSettings.selectionRevision, detail.selectionRevision);
        assert.deepEqual(calls, [['select', detail.options]]);
        assert.equal(image.group, active);
        assert.equal(other.group, active);
        assert.deepEqual(active.getObjects(), [image, other]);
        assert.deepEqual([image, other].map(object => object.getXY()), positions);
        // Style refreshes and shrinking the selection keep the selection tool active.
        await handler.select({ detail });
        await handler.select({ detail: events.select(image) });
        assert.equal(handler.state().activeTool, 'select');
        assert.equal(calls.length, 1);
    }
});
