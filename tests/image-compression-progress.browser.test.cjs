const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ts = require('typescript');

test('compression progress renders real counts, indeterminate scanning, phases and both languages', {
    skip: !process.env.IMG_TEST_ELECTRON,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'imgreeditor-progress-'));
    try {
        const compile = relative => ts.transpileModule(readFileSync(path.resolve(__dirname, '..', relative), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText;
        const browserCase = (source, i18nSource, chinese, english) => {
            const check = require('node:assert/strict');
            const evaluate = (code, imports) => {
                const module = { exports: {} };
                new Function('require', 'module', 'exports', code)(name => {
                    check.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
                    return imports[name];
                }, module, module.exports);
                return module.exports;
            };
            window.siyuan = { config: { lang: 'zh_CN' } };
            const i18n = evaluate(i18nSource, {
                '../../i18n/zh_CN.json': { default: chinese }, '../../i18n/en_US.json': { default: english },
            });
            let latest;
            class Dialog {
                constructor(options) {
                    this.element = document.createElement('div');
                    this.element.style.width = options.width;
                    this.element.innerHTML = options.content;
                    this.onDestroy = options.destroyCallback;
                    this.destroyCount = 0;
                    document.body.append(this.element);
                    latest = this;
                }
                destroy() { this.destroyCount++; this.element.remove(); this.onDestroy?.(); }
            }
            const { showImageCompressionProgress } = evaluate(source, { siyuan: { Dialog }, './i18n': i18n });
            const progress = showImageCompressionProgress('压缩当前文档及其子文档的图片');
            const root = latest.element;
            const bar = root.querySelector('progress');
            const phase = root.querySelector('[data-phase]');
            const count = root.querySelector('[data-count]');
            const file = root.querySelector('[data-file]');
            check.ok(bar.matches(':indeterminate'));
            check.equal(phase.textContent, '正在扫描文档图片');
            check.equal(count.textContent, '');
            check.equal(file.hidden, true);
            check.ok(bar.getBoundingClientRect().width > 0);
            progress.update({ phase: 'scanning', current: 1, total: 4 });
            check.equal(bar.value, 1);
            check.equal(bar.max, 4);
            check.equal(count.textContent, '1/4 · 25%');
            progress.update({ phase: 'compressing', current: 2, total: 4, fileName: '<img src=x onerror=alert(1)>.png' });
            check.equal(phase.textContent, '正在压缩图片');
            check.equal(bar.getAttribute('aria-label'), phase.textContent);
            check.equal(count.textContent, '2/4 · 50%');
            check.equal(file.textContent, '<img src=x onerror=alert(1)>.png');
            check.equal(file.hidden, false);
            check.equal(root.querySelector('img'), null);
            progress.update({ phase: 'updatingReferences', current: 0, total: 2, fileName: 'a.png' });
            check.equal(phase.textContent, '正在更新图片引用');
            check.equal(bar.value, 0);
            check.equal(count.textContent, '0/2 · 0%');
            progress.update({ phase: 'updatingReferences', current: 2, total: 2 });
            check.equal(count.textContent, '2/2 · 100%');
            progress.close();
            progress.close();
            progress.update({ phase: 'compressing', current: 1, total: 1 });
            check.equal(latest.destroyCount, 1);
            check.equal(root.isConnected, false);
            window.siyuan.config.lang = 'en_US';
            const englishProgress = showImageCompressionProgress('Compress document images');
            englishProgress.update({ phase: 'compressing', current: 1, total: 2 });
            check.equal(latest.element.querySelector('[data-phase]').textContent, 'Compressing images');
            englishProgress.close();
            check.equal(document.querySelector('.img-compression-progress'), null);
            return 'progress passed';
        };
        const args = [compile('src/utils/imageCompressionProgress.ts'), compile('src/utils/i18n.ts'),
            require('../i18n/zh_CN.json'), require('../i18n/en_US.json')];
        const html = path.join(temporary, 'index.html');
        const script = path.join(temporary, 'main.cjs');
        writeFileSync(html, '<!doctype html><body></body>');
        const code = `(${browserCase.toString()})(...${JSON.stringify(args)})`;
        writeFileSync(script, `const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    await win.loadFile(${JSON.stringify(html)});
    console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
    app.exit(0);
} catch (error) { console.error(error); app.exit(1); } });`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const { stdout } = await promisify(execFile)(process.env.IMG_TEST_ELECTRON, [script], { env, windowsHide: true, timeout: 30000 });
        assert.ok(stdout.includes('progress passed'));
    } finally {
        assert.equal(path.dirname(temporary), tmpdir());
        assert.ok(path.basename(temporary).startsWith('imgreeditor-progress-'));
        rmSync(temporary, { recursive: true, force: true });
    }
});
