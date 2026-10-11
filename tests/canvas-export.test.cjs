const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { Rect } = require('fabric');

const source = readFileSync(resolve(__dirname, '../src/components/editor/CanvasEditor.svelte'), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const parsed = ts.createSourceFile('export.ts', source, ts.ScriptTarget.Latest, true);
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) &&
    ['createExportCanvas', 'toBlob', 'toDataURL'].includes(node.name.text))
    .map(node => node.getText(parsed).replace(/^export\s+/, '')).join('\n');
const compiled = ts.transpileModule(functions + '\nreturn { toBlob, toDataURL };', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture({ canvasMode = true, fail = false, visible = true } = {}) {
    const boundary = new Rect({ left: 60, top: 40, width: 800, height: 600, fill: '#fff', visible });
    boundary._isCanvasBackground = true;
    const rendered = { width: 2400, height: 1800, toDataURL: () => { throw new Error('Unexpected Base64 encoding'); } };
    let finish, exported;
    rendered.toBlob = (callback, mime, quality) => { finish = callback; exported.mime = mime; exported.quality = quality; };
    const viewport = [0.5, 0, 0, 0.5, 15, 30];
    const canvas = { viewportTransform: viewport, width: 500, height: 400,
        enableRetinaScaling: true, skipControlsDrawing: false, backgroundColor: '#123456',
        backgroundImage: canvasMode ? null : new Rect({ left: 15, top: 25, width: 200, height: 100, scaleX: 2 }),
        getWidth() { return this.width; }, getHeight() { return this.height; }, getObjects: () => [boundary],
        setViewportTransform(matrix) { this.viewportTransform = matrix; },
        toCanvasElement(multiplier, bounds) {
            exported = { multiplier, bounds, boundaryVisible: boundary.visible, backgroundColor: this.backgroundColor };
            // Fabric temporarily changes internal state while rendering.
            this.width = bounds.width * multiplier; this.height = bounds.height * multiplier;
            this.enableRetinaScaling = false; this.skipControlsDrawing = true;
            if (fail) throw new Error('render failed');
            return rendered;
        },
        setDimensions() { throw new Error('Must not resize the live editor'); },
        renderAll() { throw new Error('Must not repaint the live editor during export'); },
    };
    const api = new Function('canvas', 'isCanvasMode', compiled)(canvas, canvasMode);
    return { ...api, canvas, boundary, rendered, viewport, finish: blob => finish(blob), getExport: () => exported };
}
function assertRestored(fixture, visible = true) {
    assert.deepEqual(fixture.canvas.viewportTransform, fixture.viewport);
    assert.equal(fixture.canvas.width, 500);
    assert.equal(fixture.canvas.height, 400);
    assert.equal(fixture.canvas.enableRetinaScaling, true);
    assert.equal(fixture.canvas.skipControlsDrawing, false);
    assert.equal(fixture.canvas.backgroundColor, '#123456');
    assert.equal(fixture.boundary.visible, visible);
}

test('Blob export preserves 3x canvas dimensions and restores the live editor before asynchronous encoding finishes', async () => {
    const editor = fixture();
    const encoding = editor.toBlob({ format: 'png', quality: 1 });
    assert.deepEqual(editor.getExport(), { multiplier: 3,
        bounds: { left: 60, top: 40, width: 800, height: 600 },
        boundaryVisible: false, backgroundColor: '#fff', mime: 'image/png', quality: 1 });
    assertRestored(editor);
    const blob = new Blob(['encoded'], { type: 'image/png' });
    editor.finish(blob);
    assert.equal(await encoding, blob);
    assert.equal(editor.rendered.width, 0);
    assert.equal(editor.rendered.height, 0);
});

test('image mode exports the original scaled image bounds at 1x and preserves hidden boundary state', async () => {
    const editor = fixture({ canvasMode: false, visible: false });
    const bounds = editor.canvas.backgroundImage.getBoundingRect();
    const encoding = editor.toBlob({ format: 'jpeg', quality: 0.92 });
    assert.equal(editor.getExport().multiplier, 1);
    assert.deepEqual(editor.getExport().bounds, bounds);
    assertRestored(editor, false);
    editor.finish(new Blob(['jpeg'], { type: 'image/jpeg' }));
    await encoding;
});

test('render and encoding failures restore canvas state and release export buffers', async () => {
    const renderFailure = fixture({ fail: true });
    await assert.rejects(renderFailure.toBlob(), /render failed/);
    assertRestored(renderFailure);
    const nullBlob = fixture();
    const encoding = nullBlob.toBlob();
    nullBlob.finish(null);
    assert.equal(await encoding, null);
    assert.equal(nullBlob.rendered.width, 0);
    assertRestored(nullBlob);
});
