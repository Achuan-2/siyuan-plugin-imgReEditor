const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { FabricImage, FabricObject, setEnv } = require('fabric');

const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helperModule = { exports: {} };
new Function('require', 'module', 'exports', compile(readFileSync(
    resolve(__dirname, '../src/components/editor/imageCornerRadius.ts'), 'utf8'
)))(require, helperModule, helperModule.exports);
const helpers = helperModule.exports;
const interactionModule = { exports: {} };
new Function('module', 'exports', compile(readFileSync(
    resolve(__dirname, '../src/components/editor/textInteractionState.ts'), 'utf8'
)))(interactionModule, interactionModule.exports);
const { applyImageCornerRadius, getImageCornerRadiusPercent, getImageBorderRadiusOptions,
    getImageBorderSourceSize } = helpers;

function imageElement(width = 200, height = 100) {
    const image = { width, height, naturalWidth: width, naturalHeight: height, classList: { add() {}, remove() {} } };
    Object.defineProperty(image, 'src', {
        get: () => image.url || 'fixture.png',
        set: value => { image.url = value; queueMicrotask(() => image.onload?.()); },
    });
    return image;
}
setEnv({ document: { createElement: () => imageElement() },
    window: { devicePixelRatio: 1 }, isTouchSupported: false,
    WebGLProbe: {}, copyPasteData: {}, dispose() {},
});
const createImage = options => new FabricImage(imageElement(), options);
const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('CanvasEditor.ts', source, ts.ScriptTarget.Latest, true);
const names = ['applyToolOptionsToSelection', 'updateImageBorder', 'getStoredBorderOptions',
    'getActualImage', 'exitImageCropMode', 'restoreObjectSelectionStates'];
const functions = parsed.statements
    .filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text))
    .map(node => node.getText(parsed).replace(/^export\s+/, '')).join('\n');
const historyProperties = source.match(/const HISTORY_PROPS = \[[\s\S]*?\];/)[0];
const historyProps = new Function(compile(historyProperties) + '\nreturn HISTORY_PROPS;')();

function loadEditor(background, context) {
    const selected = [];
    const snapshots = [];
    const canvas = { backgroundImage: background, getObjects: () => selected,
        getActiveObjects: () => selected, requestRenderAll() {} };
    const imports = { ...helpers, ...interactionModule.exports, FabricImage };
    const exports = new Function(...Object.keys(imports), 'canvas', 'snapshots', 'document', compile(`
        let activeTool = 'image';
        const activeToolOptions = {};
        const dispatch = () => {};
        const dispatchSelection = detail => dispatch('selection', detail);
        let targetImageToCrop = null, imageCropBackup = null, cropRect = null;
        let _cropKeyHandler = null, isImageCropping = false;
        const isTextObject = () => false;
        function schedulePushWithType() {
            snapshots.push(canvas.backgroundImage?.toObject?.(${JSON.stringify(historyProps)}));
        }
        function applyFill(ctx, fill) { ctx.fillStyle = fill; }
        ${functions}
        return { applyToolOptionsToSelection, updateImageBorder, getStoredBorderOptions,
            restoreObjectSelectionStates, exitImageCropMode,
            setCropBackup(image, backup) { targetImageToCrop = image; imageCropBackup = backup; }
        };
    `))(...Object.values(imports), canvas, snapshots, {
        createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    return { ...exports, canvas, selected, snapshots };
}

test('image percentages follow independent scaling and legacy pixel corners retain their appearance', () => {
    const image = createImage({ scaleX: 2, scaleY: 1 });
    image._cornerRadius = 10;
    assert.equal(getImageCornerRadiusPercent(image), 20);
    applyImageCornerRadius(image);
    assert.equal(image.clipPath.rx * image.scaleX, 10);
    assert.equal(image.clipPath.ry * image.scaleY, 10);
    applyImageCornerRadius(image, 50);
    assert.equal(image.clipPath.rx, 12.5);
    assert.equal(image.clipPath.ry, 25);
    image.set({ scaleX: 1, scaleY: 2 });
    applyImageCornerRadius(image);
    assert.equal(image.clipPath.rx, 50);
    assert.equal(image.clipPath.ry, 25);
    assert.equal(getImageCornerRadiusPercent(image), 50);
    applyImageCornerRadius(image, 0);
    assert.equal(image.clipPath, null);
});

test('numeric image resize retains the percentage, including the first resize of legacy images', () => {
    const image = createImage();
    image._cornerRadius = 10;
    const editor = loadEditor();
    editor.selected.push(image);
    editor.applyToolOptionsToSelection({ width: 400 });
    assert.equal(image.getScaledWidth(), 400);
    assert.equal(image.getScaledHeight(), 200);
    assert.equal(getImageCornerRadiusPercent(image), 20);
    assert.equal(image.clipPath.rx * image.scaleX, 20);
    editor.applyToolOptionsToSelection({ cornerRadiusPercent: 100 });
    assert.equal(image.clipPath.rx * image.scaleX, 100);
    assert.equal(image.clipPath.ry * image.scaleY, 100);
});

test('native image restoration preserves rounding and a cropped replacement retains the percentage', async () => {
    const previous = FabricObject.customProperties;
    try {
        const declaration = source.match(/\(FabricObject as any\)\.customProperties = \[[\s\S]*?\];/)[0];
        new Function('FabricObject', compile(declaration))(FabricObject);
        const image = createImage({ scaleX: 2, scaleY: 1 });
        applyImageCornerRadius(image, 60);
        for (const saved of [image.toObject(), image.toObject(historyProps)]) {
            assert.equal(saved._imageCornerRadiusPercent, 60);
            const restored = await FabricImage.fromObject(saved);
            assert.equal(getImageCornerRadiusPercent(restored), 60);
            assert.equal(restored.clipPath.rx, image.clipPath.rx);
            restored.set({ scaleX: 4, scaleY: 2 });
            applyImageCornerRadius(restored);
            assert.equal(restored.clipPath.rx * restored.scaleX, 60);
        }
        const cropped = createImage({ width: 80, height: 60 });
        applyImageCornerRadius(cropped, getImageCornerRadiusPercent(image));
        assert.equal(getImageCornerRadiusPercent(cropped), 60);
        assert.equal(cropped.clipPath.rx, 18);
    } finally {
        FabricObject.customProperties = previous;
    }
});

test('legacy border pixels convert against the image and outer frame separately', () => {
    const dimensions = getImageBorderSourceSize({ width: 240, height: 140, _appliedMargin: 20 });
    assert.deepEqual(dimensions, { width: 200, height: 100 });
    assert.deepEqual(getImageBorderRadiusOptions({ margin: 20, radius: 10, outerRadius: 14 }, 200, 100), {
        radiusPercent: 20, outerRadiusPercent: 20,
    });
    const original = createImage({ scaleX: 2, scaleY: 2 });
    assert.deepEqual(getImageBorderSourceSize(original), { width: 400, height: 200 });
    assert.deepEqual(getImageBorderSourceSize({ _unborderedImage: original }), { width: 400, height: 200 });
});

test('restoring a project converts legacy images, and crop cancellation restores the original percentage', () => {
    const image = createImage({ left: 10, top: 20 });
    image._cornerRadius = 10;
    const editor = loadEditor();
    editor.selected.push(image);
    editor.restoreObjectSelectionStates();
    assert.equal(getImageCornerRadiusPercent(image), 20);
    const backup = { left: image.left, top: image.top, width: image.width, height: image.height,
        scaleX: image.scaleX, scaleY: image.scaleY, angle: image.angle,
        originX: image.originX, originY: image.originY, element: image.getElement(), cornerRadiusPercent: 20 };
    editor.setCropBackup(image, backup);
    image.set({ width: 800, height: 600, left: 0, top: 0, clipPath: null });
    editor.exitImageCropMode();
    assert.equal(image.width, 200);
    assert.equal(image.height, 100);
    assert.equal(image.left, 10);
    assert.equal(image.top, 20);
    assert.equal(getImageCornerRadiusPercent(image), 20);
    assert.equal(image.clipPath.rx, 10);
});

test('border rendering clips the whole result and retains percentages when the margin changes', async () => {
    const paths = [];
    const renderedClips = [];
    const stack = [];
    let clips = [];
    let path;
    const context = {
        save: () => stack.push([...clips]), restore: () => { clips = stack.pop(); },
        beginPath() {}, roundRect: (...args) => { path = args; paths.push(args); },
        clip: () => clips.push(path), fillRect() {}, translate() {},
    };
    const main = { width: 200, height: 100, getBoundingRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
        toDataURL: () => 'fixture.png', render: () => renderedClips.push([...clips]) };
    const editor = loadEditor(main, context);
    const options = { margin: 20, radiusPercent: 50, outerRadiusPercent: 100, shadowBlur: 0 };
    await editor.updateImageBorder(options);
    assert.deepEqual(paths, [[0, 0, 240, 140, 70], [0, 0, 200, 100, 25]]);
    assert.equal(renderedClips[0].length, 2);
    assert.equal(stack.length, 0);
    assert.equal(editor.getStoredBorderOptions().radiusPercent, 50);
    assert.equal(editor.getStoredBorderOptions().outerRadiusPercent, 100);
    await editor.updateImageBorder({ ...options, margin: 40 });
    assert.equal(editor.canvas.backgroundImage._borderRadius, 25);
    assert.equal(editor.canvas.backgroundImage._outerRadius, 90);
    const snapshot = editor.snapshots.at(-1);
    assert.equal(snapshot._borderRadiusPercent, 50);
    assert.equal(snapshot._outerRadiusPercent, 100);
    const restored = await FabricImage.fromObject(snapshot);
    const restoredEditor = loadEditor(restored, context);
    assert.equal(restoredEditor.getStoredBorderOptions().radiusPercent, 50);
    assert.equal(restoredEditor.getStoredBorderOptions().outerRadiusPercent, 100);
});
