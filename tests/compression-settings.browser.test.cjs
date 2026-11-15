const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

test('compression settings switch format controls and preserve hidden values after reopening', {
    skip: !process.env.IMG_TEST_ELECTRON,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'imgreeditor-settings-'));
    try {
        const { build } = await import('vite');
        const { svelte, vitePreprocess } = await import('@sveltejs/vite-plugin-svelte');
        const root = path.resolve(__dirname, '..');
        const sourcePath = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
        const bundle = await build({
            configFile: false, root, logLevel: 'silent',
            resolve: { alias: { '@': path.join(root, 'src') } },
            plugins: [{
                name: 'settings-fixture',
                enforce: 'pre',
                resolveId(id, importer) {
                    if (id.endsWith('virtual:settings-fixture')) return '\0virtual:settings-fixture';
                    if (id === 'siyuan') return '\0siyuan';
                    if (id === './api' && importer?.replaceAll('\\', '/').endsWith('/src/Settings.svelte')) return '\0settings-api';
                },
                load(id) {
                    if (id === '\0virtual:settings-fixture') return `
                        export { default as Settings } from ${sourcePath('src/Settings.svelte')};
                        export { tick } from 'svelte';
                        export * from ${sourcePath('src/defaultSettings.ts')};`;
                    if (id === '\0siyuan') return 'export const confirm = () => {}, Constants = {}; export class Dialog {}';
                    if (id === '\0settings-api') return 'export const pushMsg = async () => {}, pushErrMsg = pushMsg, readDir = pushMsg, removeFile = pushMsg;';
                },
            }, svelte({ preprocess: vitePreprocess() })],
            build: { write: false, minify: false, lib: { entry: 'virtual:settings-fixture', name: 'SettingsFixture', formats: ['iife'] } },
        });
        const outputs = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => result.output);
        const code = outputs.find(item => item.type === 'chunk').code;
        const browserCase = async () => {
            const assert = require('node:assert/strict');
            const { Settings, tick, getDefaultSettings, getCompressionFormat } = SettingsFixture;
            window.siyuan = { config: { lang: 'zh_CN' } };
            let stored;
            const plugin = {
                loadSettings: async () => ({ ...getDefaultSettings(), ...stored, compressionFormat: getCompressionFormat(stored) }),
                saveSettings: async settings => { stored = JSON.parse(JSON.stringify(settings)); },
            };
            const flush = async () => { await tick(); await new Promise(resolve => setTimeout(resolve, 0)); await tick(); };
            const mount = async () => {
                const component = new Settings({ target: document.body, props: { plugin } });
                await flush();
                document.querySelector('#imgreeditor-settings-tab-compression').click();
                await flush();
                return component;
            };
            const row = title => [...document.querySelectorAll('.item-wrap')].find(item => item.querySelector('.title')?.textContent === title);
            const control = title => row(title)?.querySelector('select,input');
            const change = async (title, value) => {
                const element = control(title);
                assert.ok(element, `Missing control: ${title}`);
                element.value = value;
                element.dispatchEvent(new Event('change', { bubbles: true }));
                await flush();
            };
            let component = await mount();
            assert.equal(document.querySelector('.item-wrap input').id, 'enablePasteImageCompression');
            assert.equal(control('压缩格式').value, 'webp');
            assert.deepEqual([...control('压缩格式').options].map(option => option.textContent), ['PNG', 'JPG', 'WebP', '保持源格式']);
            assert.ok(control('WebP 压缩质量'));
            assert.equal(control('PNG 压缩模式'), undefined);
            assert.equal(control('JPG/JPEG 压缩质量'), undefined);
            await change('WebP 压缩质量', '80');
            await change('压缩格式', 'png');
            assert.ok(control('PNG 压缩模式'));
            assert.equal(control('PNG 有损压缩质量'), undefined);
            assert.equal(control('WebP 压缩质量'), undefined);
            assert.equal(control('JPG/JPEG 压缩质量'), undefined);
            await change('PNG 压缩模式', 'lossy');
            await change('PNG 有损压缩质量', '70');
            await change('压缩格式', 'jpeg');
            assert.ok(control('JPG/JPEG 压缩质量'));
            assert.equal(control('PNG 压缩模式'), undefined);
            assert.equal(control('PNG 有损压缩质量'), undefined);
            assert.equal(control('WebP 压缩质量'), undefined);
            await change('JPG/JPEG 压缩质量', '60');
            await change('压缩格式', 'original');
            assert.equal(control('WebP 压缩质量').value, '80');
            assert.equal(control('PNG 有损压缩质量').value, '70');
            assert.equal(control('JPG/JPEG 压缩质量').value, '60');
            component.$destroy();
            component = await mount();
            assert.equal(control('压缩格式').value, 'original');
            assert.equal(control('WebP 压缩质量').value, '80');
            assert.equal(control('PNG 有损压缩质量').value, '70');
            component.$destroy();
            stored = { convertToWebP: false };
            component = await mount();
            assert.equal(control('压缩格式').value, 'original');
            component.$destroy();
            window.siyuan.config.lang = 'en_US';
            component = await mount();
            assert.equal(control('Compression format').value, 'original');
            component.$destroy();
            return 'settings passed';
        };
        const html = path.join(temporary, 'index.html');
        const script = path.join(temporary, 'main.cjs');
        writeFileSync(html, '<!doctype html><body></body>');
        writeFileSync(script, `const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    await win.loadFile(${JSON.stringify(html)});
    const result = await win.webContents.executeJavaScript(${JSON.stringify(code + '\n(' + browserCase.toString() + ')()')});
    console.log(result); app.exit(0);
} catch (error) { console.error(error); app.exit(1); } });`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const { stdout } = await promisify(execFile)(process.env.IMG_TEST_ELECTRON, [script], { env, windowsHide: true, timeout: 30000 });
        assert.ok(stdout.includes('settings passed'));
    } finally {
        assert.equal(path.dirname(temporary), tmpdir());
        assert.ok(path.basename(temporary).startsWith('imgreeditor-settings-'));
        rmSync(temporary, { recursive: true, force: true });
    }
});
