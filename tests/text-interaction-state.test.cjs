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
const modules = new Map();
function load(name) {
    if (modules.has(name)) return modules.get(name);
    const module = { exports: {} };
    const source = readFileSync(resolve(__dirname, `../src/components/editor/${name}.ts`), 'utf8');
    new Function('require', 'module', 'exports', ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText)(path => path.startsWith('./') ? load(path.slice(2)) : require(path), module, module.exports);
    modules.set(name, module.exports);
    return module.exports;
}
const { restoreTextInteractionState } = load('textInteractionState');
const { installTextRangeRenderer } = load('textRangeStyles');
const props = ['selectable', 'hasControls', 'lockMovementX', 'lockMovementY',
    'lockRotation', 'lockScalingX', 'lockScalingY', '_textAutoWidth'];
function edit(text) {
    // Use Fabric's actual editing property lifecycle without mounting a browser textarea.
    text._saveEditingProps();
    text.isEditing = true;
    text._setEditingProps();
}
function exit(text) {
    text.isEditing = false;
    text._restoreEditingProps();
}

test('saving while text is editing persists pre-edit controls and movement without disturbing live editing', async () => {
    for (const Type of [fabric.Textbox, fabric.IText]) {
        const text = new Type('挑战在思源笔记', { left: 164.674, top: 310.7022, width: 470, fontSize: 67,
            fill: '#ed2424', stroke: '#ffffff', strokeWidth: 5.5 });
        installTextRangeRenderer(text);
        const serializer = text.toObject;
        installTextRangeRenderer(text);
        assert.equal(text.toObject, serializer);
        const before = text.toObject(props);
        edit(text);
        text.selectionStart = 1;
        text.selectionEnd = 3;
        const savedProps = text._savedProps;
        const saved = text.toObject(props);
        assert.deepEqual(saved, before);
        assert.equal(text.isEditing, true);
        assert.equal(text.hasControls, false);
        assert.equal(text.lockMovementX, true);
        assert.equal(text.selectable, false);
        assert.equal(text._savedProps, savedProps);
        assert.equal(text.selectionStart, 1);
        assert.equal(text.selectionEnd, 3);
        const loaded = await Type.fromObject(JSON.parse(JSON.stringify(saved)));
        assert.equal(loaded.hasControls, true);
        assert.equal(loaded.lockMovementX, false);
        assert.equal(loaded.selectable, true);
        assert.equal(loaded.text, text.text);
        exit(text);
        assert.deepEqual(text.toObject(props), before);
    }
});

test('serialization keeps intentional locks and inline text styles while editing, including grouped text', async () => {
    const text = new fabric.Textbox('白字黑影', { width: 300, lockMovementX: true, lockMovementY: true,
        lockRotation: true, lockScalingX: true, lockScalingY: true, hasControls: false });
    text.styles = { 0: { 1: { fill: '#ffffff', _textShadow: { color: '#000000', blur: 3, offsetX: 2, offsetY: 2 } } } };
    const group = new fabric.Group([text]);
    installTextRangeRenderer(group);
    const before = group.toObject(props);
    edit(text);
    const saved = group.toObject(props);
    assert.deepEqual(saved, before);
    const loaded = await fabric.Group.fromObject(JSON.parse(JSON.stringify(saved)));
    restoreTextInteractionState(loaded);
    const child = loaded.getObjects()[0];
    assert.equal(child.hasControls, false);
    assert.equal(child.lockMovementX, true);
    assert.equal(child.lockScalingX, true);
    assert.deepEqual(child.styles, text.styles);
    exit(text);
});

test('the supplied backup editing-state signature is repaired on restoration, including nested text', async () => {
    // Relevant fields from canvas-20261011104445-b7ubjb3.png.json; no image data is needed.
    const data = { type: 'Textbox', text: '挑战在思源笔记', fontSize: 67, fontFamily: 'Yozai', fontWeight: 'bold',
        left: 164.674, top: 310.7022, width: 470, fill: '#ed2424', stroke: '#ffffff', strokeWidth: 5.5,
        selectable: true, evented: true, _textAutoWidth: true, hasControls: false,
        lockMovementX: true, lockMovementY: true, lockRotation: false, lockScalingX: false, lockScalingY: false };
    const text = await fabric.Textbox.fromObject(data);
    const before = text.toObject(props);
    const group = new fabric.Group([text]);
    restoreTextInteractionState(group);
    assert.equal(text.hasControls, true);
    assert.equal(text.lockMovementX, false);
    assert.equal(text.lockMovementY, false);
    const after = text.toObject(props);
    for (const key of ['text', 'fontSize', 'fontFamily', 'fill', 'stroke', 'strokeWidth', 'width', '_textAutoWidth']) {
        assert.deepEqual(after[key], before[key]);
    }
    const repaired = await fabric.Textbox.fromObject(after);
    assert.equal(repaired.hasControls, true);
    assert.equal(repaired.lockMovementX, false);
});

test('restoration leaves live editing and deliberate locks untouched', () => {
    const text = new fabric.Textbox('正在编辑', { width: 300 });
    edit(text);
    restoreTextInteractionState(text);
    assert.equal(text.hasControls, false);
    assert.equal(text.lockMovementX, true);
    exit(text);
    assert.equal(text.hasControls, true);
    for (const lock of ['lockRotation', 'lockScalingX', 'lockScalingY']) {
        const locked = new fabric.Textbox('已锁定', { width: 300, hasControls: false,
            lockMovementX: true, lockMovementY: true, [lock]: true });
        restoreTextInteractionState(locked);
        assert.equal(locked.hasControls, false);
        assert.equal(locked.lockMovementX, true);
    }
});
