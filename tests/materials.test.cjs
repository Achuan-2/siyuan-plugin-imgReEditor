const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const fabric = require('fabric');
const { Rect, Group, ActiveSelection, Textbox, FabricImage, FabricObject, Shadow, Gradient, setEnv } = fabric;

const read = name => readFileSync(resolve(__dirname, '../src/components/editor/', name), 'utf8');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
let id = 0;
function loadModule(name) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compile(read(name)))(dependency => {
        if (dependency === '../../api') return { putFile() { throw new Error('Unexpected real storage write'); } };
        if (dependency === '../../utils/uuid') return { generateId: () => `object-${++id}` };
        return require(dependency);
    }, module, module.exports);
    return module.exports;
}
const { MaterialLibrary, MATERIAL_LIBRARY_DIR, getMaterialFolderPath, searchMaterials } = loadModule('materialLibrary.ts');
const { createMaterialSnapshot, restoreMaterialObjects, embedMaterialImageSources } = loadModule('materialObjects.ts');
const { createImageMaterialSnapshot, importMaterialImages } = loadModule('materialImageImport.ts');
const { applyImageCornerRadius } = loadModule('imageCornerRadius.ts');
const { applyRectangleCornerRadius } = loadModule('rectangleCornerRadius.ts');
const snapshot = { version: 1, thumbnail: 'data:image/png;base64,cHJldmlldw==', objects: [{ type: 'Rect', width: 50, height: 30 }] };
function storageFixture() {
    const files = new Map();
    let fail = false;
    let sequence = 0;
    const storage = {
        async read(path) { return files.get(path) ?? null; },
        async write(path, content) {
            if (fail && path.endsWith('/index.json')) throw new Error('write failed');
            files.set(path, content);
        },
        async remove(path) { files.delete(path); },
    };
    return { files, storage, library: new MaterialLibrary(storage, () => `material-${++sequence}`),
        fail(value) { fail = value; } };
}
function observe(library) {
    let state;
    library.subscribe(index => state = index);
    return () => state;
}

test('folders, material naming, search, moving and deletion persist after reload', async () => {
    const { library, storage, files } = storageFixture();
    const state = observe(library);
    const parent = await library.addFolder('标注', null);
    const child = await library.addFolder('常用箭头', parent.id);
    const first = await library.addItem(' 黄色箭头 ', child.id, snapshot);
    assert.equal(first.name, '黄色箭头');
    assert.equal(getMaterialFolderPath(state(), child.id), '标注 / 常用箭头');
    assert.equal(searchMaterials(state(), '标注 黄色')[0].id, first.id);
    assert.equal(searchMaterials(state(), '不存在').length, 0);
    assert.equal(searchMaterials(state(), '', '').length, 0);
    await library.renameFolder(child.id, 'Shapes');
    assert.equal(searchMaterials(state(), 'shapes')[0].id, first.id);
    await library.updateItem(first.id, '圆角矩形', parent.id);
    const reloaded = new MaterialLibrary(storage);
    const reloadState = observe(reloaded);
    await reloaded.load();
    assert.equal(reloadState().items[0].name, '圆角矩形');
    assert.equal(reloadState().items[0].folderId, parent.id);
    assert.deepEqual(await reloaded.readItem(first.id), snapshot);
    await reloaded.removeItem(first.id);
    assert.equal(reloadState().items.length, 0);
    assert.equal(files.has(`${MATERIAL_LIBRARY_DIR}/items/${first.id}.json`), false);
});

test('removing a folder retains its materials and reparents nested folders', async () => {
    const { library } = storageFixture();
    const state = observe(library);
    const parent = await library.addFolder('Parent', null);
    const middle = await library.addFolder('Middle', parent.id);
    const child = await library.addFolder('Child', middle.id);
    await library.addItem('Shape', middle.id, snapshot);
    await library.removeFolder(middle.id);
    assert.equal(state().items[0].folderId, parent.id);
    assert.equal(state().folders.find(folder => folder.id === child.id).parentId, parent.id);
    await library.removeFolder(parent.id);
    assert.equal(state().items[0].folderId, null);
    assert.equal(state().folders[0].parentId, null);
});

test('simultaneous changes are serialized; failed index writes preserve existing state and permit retry', async () => {
    const fixture = storageFixture();
    const state = observe(fixture.library);
    const original = await fixture.library.addItem('Original', null, snapshot);
    const previousIndex = fixture.files.get(`${MATERIAL_LIBRARY_DIR}/index.json`);
    fixture.fail(true);
    await assert.rejects(fixture.library.updateItem(original.id, 'Changed', null), /write failed/);
    assert.equal(state().items[0].name, 'Original');
    assert.equal(fixture.files.get(`${MATERIAL_LIBRARY_DIR}/index.json`), previousIndex);
    await assert.rejects(fixture.library.addItem('Failed', null, snapshot), /write failed/);
    assert.equal(state().items.length, 1);
    fixture.fail(false);
    await Promise.all([fixture.library.addItem('A', null, snapshot), fixture.library.addItem('B', null, snapshot)]);
    assert.deepEqual(state().items.map(item => item.name), ['Original', 'A', 'B']);
    const reloaded = new MaterialLibrary(fixture.storage);
    const reloadedState = observe(reloaded);
    await reloaded.load();
    assert.equal(reloadedState().items.length, 3);
});

test('a damaged or unreadable index is never replaced with an empty library', async () => {
    const fixture = storageFixture();
    const path = `${MATERIAL_LIBRARY_DIR}/index.json`;
    fixture.files.set(path, '{broken json');
    await assert.rejects(fixture.library.addItem('New', null, snapshot));
    assert.equal(fixture.files.get(path), '{broken json');
    fixture.files.delete(path);
    await fixture.library.addItem('Retry', null, snapshot);
    const library = new MaterialLibrary({ ...fixture.storage, read: async () => { throw new Error('offline'); } });
    await assert.rejects(library.addFolder('New', null), /offline/);
    assert.equal(JSON.parse(fixture.files.get(path)).items[0].name, 'Retry');
});

test('nested images, original crop sources and patterns are embedded once, and failed reads abort', async () => {
    const calls = [];
    const payload = { objects: [{ src: 'blob:temporary', _originalSrc: '/assets/original.png',
        clipPath: { src: 'blob:temporary' }, fill: { source: '/assets/original.png' },
        nested: { _unborderedSrc: 'data:image/png;base64,aQ==' } }] };
    await embedMaterialImageSources(payload, async url => { calls.push(url); return `data:image/png;base64,${Buffer.from(url).toString('base64')}`; });
    assert.deepEqual(calls, ['blob:temporary', '/assets/original.png']);
    assert.equal(payload.objects[0].src, payload.objects[0].clipPath.src);
    assert.equal(payload.objects[0]._originalSrc, payload.objects[0].fill.source);
    assert.equal(payload.objects[0].nested._unborderedSrc, 'data:image/png;base64,aQ==');
    await assert.rejects(embedMaterialImageSources({ src: 'missing.png' }, async () => { throw new Error('missing'); }), /missing/);
});

function imageElement() {
    const image = { width: 200, height: 100, naturalWidth: 200, naturalHeight: 100, classList: { add() {}, remove() {} } };
    Object.defineProperty(image, 'src', { get: () => image.url || 'data:image/png;base64,aQ==',
        set: value => { image.url = value; queueMicrotask(() => image.onload?.()); } });
    return image;
}
setEnv({ document: { createElement: tag => tag === 'img' ? imageElement() :
    { getContext: () => ({ measureText: text => ({ width: [...text].length * 201.25 }) }) } },
    window: { devicePixelRatio: 1 }, isTouchSupported: false, WebGLProbe: {}, copyPasteData: {}, dispose() {} });
const editorSource = read('CanvasEditor.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
new Function('FabricObject', compile(editorSource.match(/\(FabricObject as any\)\.customProperties = \[[\s\S]*?\];/)[0]))(FabricObject);
const historyProps = new Function(compile(editorSource.match(/const HISTORY_PROPS = \[[\s\S]*?\];/)[0]) + '\nreturn HISTORY_PROPS;')();
const properties = [...historyProps, 'id', 'sourceId', 'viewId'];
// Exercise native Fabric cloning/serialization; avoid simulating browser PNG rendering.
FabricObject.prototype.toDataURL = () => 'data:image/png;base64,cHJldmlldw==';
function prepare(object) {
    if (object.type === 'rect') applyRectangleCornerRadius(object);
    if (object.type === 'image') applyImageCornerRadius(object);
    object.getObjects?.().forEach(prepare);
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('saving a transformed active selection preserves world positions and leaves originals untouched', async () => {
    const a = new Rect({ left: 10, top: 20, width: 100, height: 50, fill: '#ffff00' });
    const b = new Rect({ left: 200, top: 150, width: 80, height: 70 });
    const selection = new ActiveSelection([a, b]);
    selection.set({ angle: 35, scaleX: 1.4, scaleY: 0.8 });
    const matrix = a.calcTransformMatrix();
    const original = a.toObject();
    const material = await createMaterialSnapshot([a, b], properties, prepare);
    const restored = await restoreMaterialObjects(material, prepare);
    restored[0].calcTransformMatrix().forEach((value, index) => near(value, matrix[index]));
    assert.deepEqual(a.toObject(), original);
    assert.equal(a.group, selection);
    assert.equal(restored[0].fill, '#ffff00');
    assert.equal(restored.length, 2);
});

test('grouped text, vector styles and cropped images remain native editable objects after JSON reload', async () => {
    const text = new Textbox('可编辑文字', { width: 240, fontSize: 36, fill: '#ffff00', fontWeight: 'bold',
        shadow: new Shadow({ color: '#000000', blur: 6, offsetX: 4, offsetY: 4 }) });
    text.textBackgroundEnabled = true;
    text.textBackgroundFill = '#ff0000';
    text.textBackgroundRadiusPercent = 40;
    text.textBackgroundStrokeWidth = 3;
    text._textAutoWidth = false;
    const rect = new Rect({ width: 160, height: 80, stroke: '#000000', strokeWidth: 3,
        fill: new Gradient({ type: 'linear', coords: { x1: 0, y1: 0, x2: 160, y2: 0 },
            colorStops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#ffff00' }] }) });
    rect._rectCornerRadiusPercent = 60;
    const image = new FabricImage(imageElement(), { width: 120, height: 60, cropX: 20, cropY: 10 });
    image._imageCornerRadiusPercent = 25;
    image._originalSrc = 'data:image/png;base64,b3JpZ2luYWw=';
    image._cropOffset = { x: 20, y: 10 };
    const group = new Group([text, rect, image], { left: 120, top: 150, angle: 15 });
    const material = await createMaterialSnapshot([group], properties, prepare);
    const [restored] = await restoreMaterialObjects(JSON.parse(JSON.stringify(material)), prepare);
    assert.ok(restored instanceof Group);
    const [loadedText, loadedRect, loadedImage] = restored.getObjects();
    assert.ok(loadedText instanceof Textbox);
    assert.equal(loadedText.text, '可编辑文字');
    assert.equal(loadedText.textBackgroundRadiusPercent, 40);
    assert.equal(loadedText.textBackgroundStrokeWidth, 3);
    assert.equal(loadedText._textAutoWidth, false);
    assert.ok(loadedText.shadow instanceof Shadow);
    loadedText.set('text', '修改后的文字');
    assert.equal(loadedText.text, '修改后的文字');
    assert.ok(loadedRect.fill instanceof Gradient);
    assert.equal(loadedRect._rectCornerRadiusPercent, 60);
    assert.ok(loadedImage instanceof FabricImage);
    assert.equal(loadedImage.cropX, 20);
    assert.equal(loadedImage.cropY, 10);
    assert.equal(loadedImage._imageCornerRadiusPercent, 25);
    assert.equal(loadedImage._originalSrc, image._originalSrc);
    assert.deepEqual(loadedImage._cropOffset, image._cropOffset);
    assert.ok(loadedImage.clipPath instanceof Rect);
});

test('repeated insertion uses fresh linked IDs and unlocks saved objects', async () => {
    const a = new Rect({ width: 80, height: 40, lockMovementX: true });
    const b = new Rect({ width: 40, height: 40 });
    a.id = 'view'; a.sourceId = 'source'; b.id = 'source'; b.viewId = 'view';
    const material = await createMaterialSnapshot([a, b], properties, prepare);
    const first = await restoreMaterialObjects(material, prepare);
    const second = await restoreMaterialObjects(material, prepare);
    assert.equal(first[0].sourceId, first[1].id);
    assert.equal(first[1].viewId, first[0].id);
    assert.notEqual(first[0].id, second[0].id);
    assert.equal(first[0].lockMovementX, false);
    assert.equal(first[0].selectable, true);
    assert.equal(first[0].hasControls, true);
});

test('canvas insertion centers the saved arrangement, selects it and records undo history', async () => {
    const parsed = ts.createSourceFile('editor.ts', editorSource, ts.ScriptTarget.Latest, true);
    const body = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'insertMaterial')
        .getText(parsed).replace(/^export\s+/, '');
    const added = [], history = [];
    let selected, updated = false;
    const canvas = { add: (...objects) => added.push(...objects), discardActiveObject() {},
        setActiveObject: object => selected = object, requestRenderAll() {}, getVpCenter: () => ({ x: 500, y: 300 }) };
    const insert = new Function('canvas', 'restoreMaterialObjects', 'prepareMaterialObject', 'ActiveSelection',
        'schedulePushWithType', 'updateCurrentNumberFromCanvas', compile(body) + '\nreturn insertMaterial;')(
        canvas, restoreMaterialObjects, prepare, ActiveSelection, type => history.push(type), () => updated = true);
    await insert(snapshot);
    const bounds = added[0].getBoundingRect();
    near(bounds.left + bounds.width / 2, 500);
    near(bounds.top + bounds.height / 2, 300);
    assert.equal(selected, added[0]);
    assert.deepEqual(history, ['added']);
    assert.equal(updated, true);
});

test('the right-click save handler captures the selected objects and dispatches editable material data', async () => {
    const parsed = ts.createSourceFile('editor.ts', editorSource, ts.ScriptTarget.Latest, true);
    const body = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'saveObjectAsMaterial')
        .getText(parsed);
    const text = new Textbox('命名建议', { fontSize: 32, width: 220 });
    const shape = new Rect({ width: 50, height: 25 });
    const events = [], errors = [];
    const capture = new Function('canvas', 'createMaterialSnapshot', 'HISTORY_PROPS', 'prepareMaterialObject',
        'isTextObject', 'dispatch', 'pushErrMsg', 't', compile(body) + '\nreturn saveObjectAsMaterial;')(
        { getObjects: () => [shape, text] }, createMaterialSnapshot, historyProps, prepare,
        object => object.type === 'textbox', (name, detail) => events.push({ name, detail }), error => errors.push(error), key => key);
    await capture(text);
    assert.equal(events[0].name, 'saveMaterial');
    assert.equal(events[0].detail.suggestedName, '命名建议');
    assert.equal(events[0].detail.snapshot.objects.length, 1);
    assert.equal(events[0].detail.snapshot.objects[0].text, text.text);
    const selection = new ActiveSelection([shape, text]);
    await capture(selection);
    assert.deepEqual(events[1].detail.snapshot.objects.map(object => object.type), ['Rect', 'Textbox']);
    assert.deepEqual(errors, []);
});

function loadSaveDialog(library) {
    let mounted, destroy;
    let closes = 0;
    const script = read('MaterialSaveDialog.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1]
        .replace(/export let snapshot: MaterialSnapshot;/, 'let snapshot = initialSnapshot;')
        .replace(/export let suggestedName = '';/, 'let suggestedName = initialName;')
        .replace(/export let onClose: \(\) => void;/, 'let onClose = closeCallback;')
        .replace(/^    \$: (\w+) =/gm, '    let $1 =');
    const module = { exports: {} };
    const imports = {
        svelte: { onMount: callback => mounted = callback, onDestroy: callback => destroy = callback, tick: async () => {} },
        '../../utils/i18n': { t: (key, values) => values?.error ? `${key}: ${values.error}` : key },
        './materialLibrary': { materialLibrary: library, getMaterialFolderPath },
    };
    new Function('require', 'module', 'exports', 'initialSnapshot', 'initialName', 'closeCallback', compile(script + `
        module.exports = { save, createFolder,
            configure(name, destination = '', newFolder = '') { materialName = name; folder = destination; folderName = newFolder; },
            state: () => ({ loaded, busy, error, materialName, folder, index }),
        };
    `))(name => imports[name], module, module.exports, snapshot, '默认素材名', () => closes++);
    mounted();
    return { ...module.exports, closes: () => closes, destroy: () => destroy() };
}

test('the material save dialog creates folders and saves the named editable snapshot, publishing it to library subscribers', async () => {
    const fixture = storageFixture();
    const state = observe(fixture.library);
    const dialog = loadSaveDialog(fixture.library);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialog.state().loaded, true);
    assert.equal(dialog.state().materialName, '默认素材名');
    dialog.configure('图例', '', '常用');
    await dialog.createFolder();
    const folderId = dialog.state().folder;
    assert.equal(state().folders[0].name, '常用');
    await dialog.save();
    assert.equal(state().items[0].name, '图例');
    assert.equal(state().items[0].folderId, folderId);
    assert.deepEqual(await fixture.library.readItem(state().items[0].id), snapshot);
    assert.equal(dialog.closes(), 1);
    dialog.destroy();
});

test('failed modal saves preserve input for retry; closing without saving leaves the library unchanged', async () => {
    const fixture = storageFixture();
    const state = observe(fixture.library);
    const cancelled = loadSaveDialog(fixture.library);
    await new Promise(resolve => setImmediate(resolve));
    cancelled.destroy();
    assert.equal(state().items.length, 0);
    const dialog = loadSaveDialog(fixture.library);
    await new Promise(resolve => setImmediate(resolve));
    dialog.configure('重试素材');
    fixture.fail(true);
    await dialog.save();
    assert.equal(dialog.closes(), 0);
    assert.equal(dialog.state().materialName, '重试素材');
    assert.match(dialog.state().error, /write failed/);
    assert.equal(state().items.length, 0);
    fixture.fail(false);
    await dialog.save();
    assert.equal(dialog.closes(), 1);
    assert.equal(state().items.length, 1);
    dialog.destroy();
});

test('right-click saving opens a separate dialog and retains the current tool and sidebar visibility', () => {
    const parent = readFileSync(resolve(__dirname, '../src/components/ImageEditor.svelte'), 'utf8');
    const script = parent.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const parsed = ts.createSourceFile('ImageEditor.ts', script, ts.ScriptTarget.Latest, true);
    const body = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'openMaterialSaveDialog').getText(parsed);
    const dialogs = [];
    const open = new Function('svelteDialog', 'MaterialSaveDialog', 't', compile(`
        let materialSaveDialog = null;
        const activeTool = 'select', sidebarVisible = false;
        ${body}
        return { openMaterialSaveDialog, state: () => ({ activeTool, sidebarVisible, materialSaveDialog }) };
    `))(args => {
        const dialog = { component: args.constructor({}), closed: 0,
            close() { this.closed++; args.callback(); } };
        dialogs.push(dialog);
        return dialog;
    }, class { constructor({ props }) { this.props = props; } }, key => key);
    open.openMaterialSaveDialog({ snapshot, suggestedName: '文本素材' });
    assert.equal(dialogs[0].component.props.suggestedName, '文本素材');
    assert.equal(dialogs[0].component.props.snapshot, snapshot);
    assert.equal(open.state().activeTool, 'select');
    assert.equal(open.state().sidebarVisible, false);
    open.openMaterialSaveDialog({ snapshot, suggestedName: '新素材' });
    assert.equal(dialogs[0].closed, 1);
    dialogs[1].component.props.onClose();
    assert.equal(open.state().materialSaveDialog, null);
    assert.equal(dialogs[1].closed, 1);
});

test('saving materials remembers the folder across dialogs and library reloads, including unfiled', async () => {
    const fixture = storageFixture();
    const folder = await fixture.library.addFolder('常用素材', null);
    const first = loadSaveDialog(fixture.library);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(first.state().folder, '');
    first.configure('素材一', folder.id);
    await first.save();
    first.destroy();
    const reloaded = new MaterialLibrary(fixture.storage);
    const second = loadSaveDialog(reloaded);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(second.state().folder, folder.id);
    second.configure('素材二', '');
    await second.save();
    second.destroy();
    const third = loadSaveDialog(new MaterialLibrary(fixture.storage));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(third.state().folder, '');
    third.destroy();
});

test('cancelling or failing a save retains the remembered destination; deleted folders fall back to unfiled', async () => {
    const fixture = storageFixture();
    const original = await fixture.library.addFolder('原文件夹', null);
    const other = await fixture.library.addFolder('另一文件夹', null);
    await fixture.library.addItem('已有素材', original.id, snapshot);
    const cancelled = loadSaveDialog(fixture.library);
    await new Promise(resolve => setImmediate(resolve));
    cancelled.configure('取消保存', other.id);
    cancelled.destroy();
    assert.equal(fixture.library.getLastSaveFolderId(), original.id);
    const failed = loadSaveDialog(fixture.library);
    await new Promise(resolve => setImmediate(resolve));
    failed.configure('失败保存', other.id);
    fixture.fail(true);
    await failed.save();
    assert.equal(fixture.library.getLastSaveFolderId(), original.id);
    failed.destroy();
    fixture.fail(false);
    await fixture.library.removeFolder(original.id);
    const reloaded = new MaterialLibrary(fixture.storage);
    const dialog = loadSaveDialog(reloaded);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialog.state().folder, '');
    dialog.destroy();
});

async function withFileReader(action) {
    const previous = globalThis.FileReader;
    globalThis.FileReader = class {
        readAsDataURL(file) {
            file.arrayBuffer().then(buffer => {
                this.result = `data:${file.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
                this.onload?.();
            }).catch(error => { this.error = error; this.onerror?.(); });
        }
    };
    try { await action(); }
    finally { globalThis.FileReader = previous; }
}

test('uploaded images retain original bytes and cropping source through material persistence and native restoration', async () => {
    await withFileReader(async () => {
        const file = new File([Buffer.from([1, 2, 3, 4])], '示意图.png', { type: 'image/png' });
        const material = await createImageMaterialSnapshot(file);
        assert.equal(material.objects.length, 1);
        assert.equal(material.objects[0].type, 'Image');
        assert.equal(material.objects[0].src, 'data:image/png;base64,AQIDBA==');
        assert.equal(material.objects[0]._originalSrc, material.objects[0].src);
        assert.deepEqual(material.objects[0]._cropOffset, { x: 0, y: 0 });
        assert.equal(material.objects[0].width, 200);
        assert.equal(material.objects[0].height, 100);
        const fixture = storageFixture();
        const item = await fixture.library.addItem('示意图', null, material);
        const reloaded = new MaterialLibrary(fixture.storage);
        const [image] = await restoreMaterialObjects(await reloaded.readItem(item.id), prepare);
        assert.ok(image instanceof FabricImage);
        assert.equal(image._originalSrc, material.objects[0].src);
        assert.equal(image.selectable, true);
        image.set({ cropX: 20, width: 100 });
        assert.equal(image.cropX, 20);
        assert.equal(image.width, 100);
        image.dispose();
    });
});

test('multi-image upload names files and saves in the chosen folder, continuing after invalid files with accurate progress', async () => {
    await withFileReader(async () => {
        const fixture = storageFixture();
        const state = observe(fixture.library);
        const folder = await fixture.library.addFolder('图片', null);
        const progress = [];
        const files = [new File(['first'], ' 图片.v2.png ', { type: 'image/png' }),
            new File(['bad'], '说明.txt', { type: 'text/plain' }),
            new File(['read'], '无法读取.png', { type: 'image/png' }),
            new File(['last'], '第二张.webp', { type: 'image/webp' })];
        files[2].arrayBuffer = async () => { throw new Error('read failed'); };
        const result = await importMaterialImages(files, folder.id, fixture.library, (completed, total) => progress.push([completed, total]));
        assert.equal(result.imported, 2);
        assert.deepEqual(result.failures.map(item => item.name), ['说明.txt', '无法读取.png']);
        assert.match(result.failures[1].error, /read failed/);
        assert.deepEqual(state().items.map(item => [item.name, item.folderId]), [['图片.v2', folder.id], ['第二张', folder.id]]);
        assert.deepEqual(progress, [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
        const reloaded = new MaterialLibrary(fixture.storage);
        for (const item of state().items) {
            const material = await reloaded.readItem(item.id);
            assert.ok(material.objects[0].src.startsWith('data:image/'));
        }
    });
});

test('image import reports failed storage writes without claiming success or preventing later imports', async () => {
    await withFileReader(async () => {
        const fixture = storageFixture();
        const state = observe(fixture.library);
        const originalWrite = fixture.storage.write;
        let first = true;
        fixture.storage.write = async (path, content) => {
            if (first && path.endsWith('/index.json')) { first = false; throw new Error('disk full'); }
            return originalWrite(path, content);
        };
        const result = await importMaterialImages([new File(['a'], '失败.png', { type: 'image/png' }),
            new File(['b'], '成功.png', { type: 'image/png' })], null, fixture.library);
        assert.equal(result.imported, 1);
        assert.deepEqual(result.failures, [{ name: '失败.png', error: 'disk full' }]);
        assert.deepEqual(state().items.map(item => item.name), ['成功']);
    });
});

test('upload entry consumes the complete file selection, captures the destination and permits selecting the same files again', async () => {
    let mounted, release, captured;
    const fixture = storageFixture();
    const script = read('MaterialPanel.svelte').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1]
        .replace(/export let onInsert:.*?;/, 'let onInsert = async () => {};')
        .replace(/^    \$: (\w+) =/gm, '    let $1 =');
    const imports = {
        svelte: { onMount: callback => mounted = callback, onDestroy() {} },
        '../../utils/i18n': { t: (key, values) => `${key}:${JSON.stringify(values || {})}` },
        './materialLibrary': { materialLibrary: fixture.library, getMaterialFolderPath, searchMaterials },
        './materialImageImport': { importMaterialImages: async (files, folder, library, progress) => {
            captured = { files, folder, library };
            progress(0, files.length);
            await new Promise(resolve => release = resolve);
            progress(files.length, files.length);
            return { imported: files.length, failures: [] };
        } },
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compile(script + `
        module.exports = { uploadImages, destination(value) { folder = value; },
            state: () => ({ busy, uploadProgress, uploadMessage, error }) };
    `))(name => imports[name], module, module.exports);
    mounted();
    await new Promise(resolve => setImmediate(resolve));
    const files = [new File(['a'], 'a.png'), new File(['b'], 'b.png')];
    const input = { files, value: 'selected' };
    module.exports.destination('folder-one');
    const pending = module.exports.uploadImages({ currentTarget: input });
    assert.equal(input.value, '');
    assert.deepEqual(captured.files, files);
    assert.equal(captured.folder, 'folder-one');
    assert.equal(captured.library, fixture.library);
    assert.deepEqual(module.exports.state().uploadProgress, { completed: 0, total: 2 });
    module.exports.destination('folder-two');
    assert.equal(captured.folder, 'folder-one');
    release();
    await pending;
    assert.equal(module.exports.state().busy, false);
    assert.equal(module.exports.state().uploadProgress, null);
    assert.match(module.exports.state().uploadMessage, /"count":"2"/);
    assert.equal(module.exports.state().error, '');
});
