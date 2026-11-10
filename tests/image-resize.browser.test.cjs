const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ts = require('typescript');

function compile(relative) {
    return ts.transpileModule(readFileSync(path.resolve(__dirname, '..', relative), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
}

// A separate Chromium window checks actual encoded dimensions, transparency and form behavior.
test('pixel limits resize PNG/JPEG/WebP and manual dialogs inherit globals without saving overrides', {
    skip: !process.env.IMG_TEST_ELECTRON,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'imgreeditor-resize-'));
    try {
        const browserCase = async ({ utilsSource, pluginSource, upngPath }) => {
            const assert = require('node:assert/strict');
            const UPNG = require(upngPath);
            const evaluate = (source, imports) => {
                const module = { exports: {} };
                new Function('require', 'module', 'exports', source)(name => {
                    if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected import ${name}`);
                    return imports[name];
                }, module, module.exports);
                return module.exports;
            };
            let failOptimizer = false;
            const utils = evaluate(utilsSource, {
                // Exercise canvas fallback with real browser encoding; worker code has its own tests.
                './webpEncoder.worker?worker&inline': { default: class { constructor() { throw new Error('No worker'); } } },
                './pngEncoder': {
                    optimizePNGBlob: async blob => {
                        if (failOptimizer) throw new Error('Worker unavailable');
                        return blob;
                    },
                    quantizePNG: async image => new Blob([
                        UPNG.encode([image.data.buffer], image.width, image.height, 128),
                    ], { type: 'image/png' }),
                },
            });
            const canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 240;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(255,128,0,0.5)';
            ctx.fillRect(0, 0, 400, 240);
            const source = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const decode = async blob => {
                const image = await createImageBitmap(blob);
                const output = document.createElement('canvas');
                output.width = image.width;
                output.height = image.height;
                output.getContext('2d').drawImage(image, 0, 0);
                const result = { size: [image.width, image.height], pixel: [...output.getContext('2d').getImageData(5, 5, 1, 1).data] };
                image.close();
                return result;
            };
            const results = [];
            for (const [format, pngMode] of [['png', 'lossless'], ['png', 'lossy'], ['jpeg'], ['webp']]) {
                const output = await utils.reencodeImageBlob(source, format, { pngMode, quality: 0.92, maxLongEdge: 200 });
                const actual = await decode(output);
                assert.deepEqual(actual.size, [200, 120]);
                assert.equal(output.type, utils.getMimeByFormat(format));
                if (format === 'png') assert.ok(actual.pixel[3] >= 126 && actual.pixel[3] <= 129);
                if (format === 'jpeg') assert.equal(actual.pixel[3], 255);
                results.push({ format, mode: pngMode, size: actual.size });
            }
            for (const limit of [undefined, 800, 400, 0, -1, NaN]) {
                const output = await utils.reencodeImageBlob(source, 'png', { pngMode: 'lossless', maxLongEdge: limit });
                assert.deepEqual((await decode(output)).size, [400, 240]);
            }
            assert.deepEqual(utils.getImageResizeDimensions(1000, 4000, 2000), { width: 500, height: 2000 });
            assert.deepEqual(utils.getImageResizeDimensions(1, 4000, 2000), { width: 1, height: 2000 });
            failOptimizer = true;
            const fallback = await utils.reencodeImageBlob(source, 'png', { pngMode: 'lossless', maxLongEdge: 200 });
            assert.deepEqual((await decode(fallback)).size, [200, 120]);
            const animated = new Blob([Uint8Array.from([
                82, 73, 70, 70, 14, 0, 0, 0, 87, 69, 66, 80, 65, 78, 73, 77, 2, 0, 0, 0, 0, 0,
            ])], { type: 'image/webp' });
            assert.equal(await utils.reencodeImageBlob(animated, 'webp', { maxLongEdge: 200 }), animated);

            let currentDialog;
            class Dialog {
                constructor(args) {
                    this.element = document.createElement('div');
                    this.element.innerHTML = args.content;
                    document.body.append(this.element);
                    currentDialog = this;
                }
                destroy() { this.element.remove(); }
            }
            window.siyuan = { languages: { cancel: 'Cancel', confirm: 'Confirm' } };
            const Plugin = evaluate(pluginSource, {
                siyuan: { Plugin: class {}, Dialog }, '@/index.scss': {}, './Settings.svelte': {},
                './components/ImageEditor.svelte': {}, './defaultSettings': {}, './utils/i18n': { t: key => key },
                './ScreenshotManager': {}, './utils/assetUploadObserver': {}, './utils/assetImageRefresh': {},
                './utils': utils,
            }).default;
            const plugin = new Plugin();
            const metadata = JSON.stringify({ version: 1, canvasJSON: { objects: [{ type: 'Textbox', text: '可编辑文字' }] } });
            const sourceWithMetadata = new Blob([utils.insertPNGTextChunk(
                new Uint8Array(await source.arrayBuffer()), 'siyuan-plugin-imgReEditor', metadata
            )], { type: 'image/png' });
            const resizedWithMetadata = await plugin.compressImageBlob(sourceWithMetadata, 'png', 'png', {
                pngMode: 'lossless', maxLongEdge: 200,
            });
            assert.deepEqual((await decode(resizedWithMetadata)).size, [200, 120]);
            assert.equal(utils.readPNGTextChunk(
                new Uint8Array(await resizedWithMetadata.arrayBuffer()), 'siyuan-plugin-imgReEditor'
            ), metadata);
            const globalSettings = { limitImageLongEdge: true, imageMaxLongEdge: 2000 };
            plugin.settings = { ...globalSettings };
            const choices = [];
            const open = () => {
                plugin.showImageCompressionDialog('Compress', 'Confirm compression', async value => choices.push(value));
                const root = currentDialog.element;
                return { root, limit: root.querySelector('[data-limit]'), pixels: root.querySelector('[data-pixels]'),
                    submit: () => root.querySelector('form').requestSubmit() };
            };
            let form = open();
            assert.equal(form.limit.checked, true);
            assert.equal(form.pixels.value, '2000');
            assert.equal(form.pixels.disabled, false);
            form.pixels.value = '1200';
            form.submit();
            assert.deepEqual(choices, [1200]);
            assert.deepEqual(plugin.settings, globalSettings);
            form = open();
            assert.equal(form.pixels.value, '2000');
            form.limit.click();
            assert.equal(form.pixels.disabled, true);
            form.submit();
            assert.deepEqual(choices, [1200, undefined]);
            form = open();
            form.pixels.value = '0';
            form.submit();
            assert.equal(choices.length, 2);
            assert.equal(form.root.isConnected, true);
            form.root.querySelector('[data-cancel]').click();
            assert.equal(choices.length, 2);
            plugin.settings.limitImageLongEdge = false;
            form = open();
            assert.equal(form.limit.checked, false);
            assert.equal(form.pixels.disabled, true);
            form.limit.click();
            assert.equal(form.pixels.value, '2000');
            form.submit();
            assert.deepEqual(choices, [1200, undefined, 2000]);
            return { images: results.length, manualChoices: choices.length };
        };
        const fixture = {
            utilsSource: compile('src/utils/index.ts'), pluginSource: compile('src/index.ts'),
            upngPath: require.resolve('upng-js'),
        };
        const html = path.join(temporary, 'index.html');
        writeFileSync(html, '<!doctype html><body></body>');
        const script = path.join(temporary, 'main.cjs');
        writeFileSync(script, `const {app, BrowserWindow}=require('electron');
app.disableHardwareAcceleration();
app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
app.whenReady().then(async()=>{try {
    const win = new BrowserWindow({show:false, webPreferences:{nodeIntegration:true, contextIsolation:false, sandbox:false}});
    await win.loadFile(${JSON.stringify(html)});
    const result = await win.webContents.executeJavaScript('('+${JSON.stringify(browserCase.toString())}+')('+${JSON.stringify(JSON.stringify(fixture))}+')');
    console.log(JSON.stringify(result));
    app.exit(0);
} catch(error) {console.error(error); app.exit(1);}});`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const { stdout } = await promisify(execFile)(process.env.IMG_TEST_ELECTRON, [script], {
            env, windowsHide: true, timeout: 30000,
        });
        assert.deepEqual(JSON.parse(stdout.trim().split('\n').at(-1)), { images: 4, manualChoices: 3 });
    } finally {
        assert.equal(path.dirname(temporary), tmpdir());
        assert.ok(path.basename(temporary).startsWith('imgreeditor-resize-'));
        rmSync(temporary, { recursive: true, force: true });
    }
});
