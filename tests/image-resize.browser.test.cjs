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
        const browserCase = async ({ utilsSource, pluginSource, dialogSource, translations, upngPath }) => {
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

            // Lossless PNG conversion must produce actual PNG pixels, even without resizing.
            for (const inputFormat of ['jpeg', 'webp']) {
                const input = await new Promise(resolve => canvas.toBlob(resolve, `image/${inputFormat}`, 0.9));
                const output = await utils.reencodeImageBlob(input, 'png', { pngMode: 'lossless' });
                assert.deepEqual([...new Uint8Array(await output.slice(0, 8).arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
                assert.deepEqual((await decode(output)).size, [400, 240]);
                assert.equal(output.type, 'image/png');
            }
            await assert.rejects(utils.reencodeImageBlob(animated, 'jpeg'), /Animated WebP/);
            const translate = (key, params = {}) => {
                const value = key.split('.').reduce((node, part) => node?.[part], translations) || key;
                return value.replace(/\$\{([^}]+)\}/g, (match, name) => params[name] ?? match);
            };
            let currentDialog;
            class Dialog {
                constructor(args) {
                    this.args = args;
                    this.element = document.createElement('div');
                    this.element.innerHTML = args.content;
                    document.body.append(this.element);
                    currentDialog = this;
                }
                destroy() { this.args.destroyCallback?.(); this.element.remove(); }
            }
            window.siyuan = { languages: { cancel: '取消', confirm: '确认' } };
            const dialogModule = evaluate(dialogSource, { siyuan: { Dialog }, './i18n': { t: translate } });
            const jpegSource = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
            const stored = new Map([
                ['data/assets/a.png', new Blob([source, new Uint8Array(6000)], { type: 'image/png' })],
                ['data/assets/b.jpg', new Blob([jpegSource, new Uint8Array(6000)], { type: 'image/jpeg' })],
            ]);
            const api = {
                getFileBlob: async path => stored.get(path),
                putFile: async (path, _dir, blob) => stored.set(path, blob),
                pushMsg: async () => {}, pushErrMsg: async () => {},
            };
            const Plugin = evaluate(pluginSource, {
                siyuan: { Plugin: class {}, Dialog }, '@/index.scss': {}, './Settings.svelte': {},
                './components/ImageEditor.svelte': {}, './defaultSettings': {}, './utils/i18n': { t: translate },
                './ScreenshotManager': {}, './utils/assetUploadObserver': {},
                './utils/assetImageRefresh': { refreshAssetImages: async () => {} },
                './utils/imageCompressionDialog': dialogModule,
                './utils': utils, './api': api,
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
            const globalSettings = {
                limitImageLongEdge: true, imageMaxLongEdge: 2000, convertToWebP: false,
                pngCompressionMode: 'lossless', pngQuality: 92, jpegQuality: 85, webpQuality: 100,
            };
            plugin.settings = { ...globalSettings };
            const choices = [];
            const waitUntil = async condition => {
                const deadline = Date.now() + 6000;
                while (!condition()) {
                    if (Date.now() > deadline) throw new Error('Preview did not settle');
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
            };
            const open = async (paths = ['assets/a.png']) => {
                await plugin.showImageCompressionDialog('压缩图片', paths, async value => choices.push(value));
                const root = currentDialog.element;
                const form = {
                    root, limit: root.querySelector('[data-limit]'), pixels: root.querySelector('[data-pixels]'),
                    format: root.querySelector('[data-format]'), quality: root.querySelector('[data-quality]'),
                    confirm: root.querySelector('[data-confirm]'), file: root.querySelector('[data-file]'),
                    settle: () => waitUntil(() => !form.confirm.disabled),
                    submit: () => root.querySelector('form').requestSubmit(),
                    close: () => root.querySelector('[data-cancel]').click(),
                };
                await form.settle();
                return form;
            };
            const change = (element, value, event = 'input') => {
                element.value = value;
                element.dispatchEvent(new Event(event, { bubbles: true }));
            };
            let form = await open();
            assert.equal(form.limit.checked, true);
            assert.equal(form.pixels.value, '2000');
            assert.equal(form.format.value, 'png');
            assert.equal(form.quality.value, '100');
            assert.ok(form.root.querySelector('[data-quality-value]').textContent.includes('无损'));
            assert.equal(form.root.querySelector('[data-preview]').hidden, false);
            const pngSize = (await plugin.prepareImageCompression('assets/a.png', { outputFormat: 'png', pngMode: 'lossless' })).compressedBlob.size;
            assert.ok(form.root.querySelector('[data-size]').textContent.includes(`${(pngSize / 1024).toFixed(1)} KB`) || pngSize < 1024);
            change(form.pixels, '120');
            await form.settle();
            assert.deepEqual((await decode(await (await fetch(form.root.querySelector('[data-preview]').src)).blob())).size, [120, 72]);
            form.root.querySelector('[data-original]').click();
            assert.deepEqual((await decode(await (await fetch(form.root.querySelector('[data-preview]').src)).blob())).size, [400, 240]);
            form.submit();
            assert.equal(choices[0].maxLongEdge, 120);
            assert.equal(choices[0].outputFormat, 'png');
            assert.deepEqual(plugin.settings, globalSettings);

            form = await open();
            assert.equal(form.pixels.value, '2000');
            form.limit.click();
            await form.settle();
            assert.equal(form.pixels.disabled, true);
            change(form.format, 'jpeg', 'change');
            await form.settle();
            assert.equal(form.quality.value, '85');
            change(form.quality, '60');
            await form.settle();
            const jpegPreview = await (await fetch(form.root.querySelector('[data-preview]').src)).blob();
            form.submit();
            assert.equal(choices[1].maxLongEdge, undefined);
            assert.equal(choices[1].formatOptions.jpeg.quality, 0.6);
            const saved = await plugin.compressImageAsset('assets/a.png', undefined, { ...choices[1], silent: true });
            assert.equal(saved.status, 'compressed');
            assert.equal(saved.savedPath, 'assets/a.jpeg');
            assert.equal(stored.get('data/assets/a.jpeg').size, jpegPreview.size, 'Preview includes the exact saved byte size');
            assert.equal(stored.get('data/assets/a.jpeg').type, 'image/jpeg');
            assert.deepEqual(plugin.settings, globalSettings);

            form = await open(['assets/a.png', 'assets/b.jpg', 'assets/a.png']);
            assert.equal(form.file.options.length, 2, 'Deduplicate repeated document resources');
            assert.equal(form.format.value, 'original');
            change(form.quality, '50');
            await form.settle();
            change(form.file, '1', 'change');
            await waitUntil(() => !form.root.querySelector('[data-preview]').hidden);
            assert.equal(form.quality.value, '85', 'Mixed-format quality follows each format independently');
            assert.ok(form.root.querySelector('[data-total]').textContent !== '—');
            form.submit();
            assert.equal(choices[2].outputFormat, 'original');
            assert.equal(choices[2].formatOptions.png.pngMode, 'lossy');
            assert.equal(choices[2].formatOptions.png.quality, 0.5);
            assert.equal(choices[2].formatOptions.jpeg.quality, 0.85);
            assert.deepEqual(plugin.settings, globalSettings);

            plugin.settings.convertToWebP = true;
            form = await open(['assets/a.png', 'assets/b.jpg']);
            assert.equal(form.format.value, 'webp');
            assert.equal(form.quality.value, '100');
            form.close();
            assert.equal(choices.length, 3);
            plugin.settings = { ...globalSettings };
            form = await open();
            change(form.pixels, '0');
            form.submit();
            assert.equal(choices.length, 3);
            assert.equal(form.root.isConnected, true);
            form.close();

            // A preview failure must keep the source and report why JPEG is unavailable.
            stored.set('data/assets/editable.png', sourceWithMetadata);
            form = await open(['assets/editable.png']);
            change(form.format, 'jpeg', 'change');
            await waitUntil(() => !!form.root.querySelector('[data-error]').textContent);
            assert.ok(form.root.querySelector('[data-error]').textContent.includes('可编辑数据'));
            assert.equal(form.confirm.disabled, true);
            form.close();
            assert.equal(choices.length, 3);

            // Keep a settled dialog open for the host-side screenshot inspection.
            plugin.settings = { ...globalSettings };
            form = await open(['assets/a.png', 'assets/b.jpg']);
            change(form.format, 'webp', 'change');
            change(form.quality, '80');
            await form.settle();
            assert.equal(document.querySelectorAll('form').length, 1, 'Closed dialogs must leave no stale forms');
            assert.equal(form.format.value, 'webp');
            assert.equal(form.quality.value, '80');
            return { images: results.length, manualChoices: choices.length };
        };
        const fixture = {
            utilsSource: compile('src/utils/index.ts'), pluginSource: compile('src/index.ts'),
            dialogSource: compile('src/utils/imageCompressionDialog.ts'), translations: require('../i18n/zh_CN.json'),
            upngPath: require.resolve('upng-js'),
        };
        const html = path.join(temporary, 'index.html');
        writeFileSync(html, `<!doctype html><style>
:root{--b3-border-color:#dedede;--b3-theme-background:#fff;--b3-theme-surface:#f5f5f5;--b3-theme-on-surface:#666;--b3-theme-error:#c44}
body{margin:20px;font:14px system-ui;color:#222}.fn__flex-1{flex:1}.b3-dialog__action{display:flex;justify-content:flex-end;gap:8px;padding:12px;border-top:1px solid #dedede}.b3-button{border:1px solid #317df6;border-radius:5px;padding:6px 14px;background:#317df6;color:white}.b3-button--outline,.b3-button--cancel{background:white;color:#333;border-color:#ccc}.b3-button:disabled{opacity:.5}.b3-select,.b3-text-field{padding:6px;border:1px solid #ccc;border-radius:5px}.img-compression-dialog{border:1px solid #ddd;border-radius:8px;overflow:hidden}
</style><body></body>`);
        const script = path.join(temporary, 'main.cjs');
        writeFileSync(script, `const {app, BrowserWindow}=require('electron');
app.disableHardwareAcceleration();
app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
app.whenReady().then(async()=>{try {
    const win = new BrowserWindow({show:false, width:1100, height:800, webPreferences:{nodeIntegration:true, contextIsolation:false, sandbox:false, backgroundThrottling:false, offscreen:true}});
    await win.loadFile(${JSON.stringify(html)});
    const result = await win.webContents.executeJavaScript('('+${JSON.stringify(browserCase.toString())}+')('+${JSON.stringify(JSON.stringify(fixture))}+')');
    await new Promise(resolve => setTimeout(resolve, 200));
    ${process.env.IMG_TEST_PREVIEW_PATH ? `require('node:fs').writeFileSync(${JSON.stringify(process.env.IMG_TEST_PREVIEW_PATH)}, (await win.webContents.capturePage()).toPNG());` : ''}
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
