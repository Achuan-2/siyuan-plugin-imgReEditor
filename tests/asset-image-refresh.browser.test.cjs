const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createServer } = require('node:http');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ts = require('typescript');
const UPNG = require('upng-js');

// Supply an installed Electron executable and SiYuan's viewer.js to run the real browser check.
test('canonical cache reload displays new pixels and selects the correct SiYuan gallery image', {
    skip: !process.env.IMG_TEST_ELECTRON || !process.env.IMG_TEST_VIEWER_JS,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'imgreeditor-refresh-'));
    const helper = ts.transpileModule(readFileSync(path.resolve(__dirname, '../src/utils/assetImageRefresh.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const viewer = readFileSync(process.env.IMG_TEST_VIEWER_JS, 'utf8');
    let width = 1;
    let imageRequests = 0;
    const server = createServer((req, res) => {
        if (req.url === '/overwrite') { width = 3; res.end('ok'); return; }
        if (req.url === '/viewer.js') { res.end(viewer); return; }
        if (req.url.startsWith('/assets/')) {
            imageRequests++;
            res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
            res.end(Buffer.from(UPNG.encode([new Uint8Array(width * 4).fill(255).buffer], width, 1, 0)));
            return;
        }
        res.end('<!doctype html><script src="/viewer.js"></script><body></body>');
    });
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const browserCase = `async () => {
            const exports = {};
            ${helper}
            const images = [new Image(), new Image()];
            for (const img of images) {
                img.setAttribute('data-src', 'assets/测试 image.png');
                img.src = 'assets/测试 image.png';
                document.body.append(img);
                await img.decode();
            }
            const before = images[0].naturalWidth;
            await fetch('/overwrite');
            await exports.refreshAssetImages(images, 'assets/测试 image.png');
            await Promise.all(images.map(img => img.decode()));
            const srcList = ['assets/other.png', 'assets/测试 image.png'];
            const currentSrc = images[0].getAttribute('src');
            const index = srcList.findIndex(item => currentSrc.endsWith(encodeURI(item)) || currentSrc.endsWith(item));
            const list = document.createElement('ul');
            list.innerHTML = srcList.map(src => '<li><img src="'+encodeURI(src)+'"></li>').join('');
            const gallery = new Viewer(list, {initialViewIndex: index, transition: false});
            gallery.show();
            await new Promise((resolve, reject) => {
                const deadline = Date.now() + 4000;
                const poll = () => gallery.viewed ? resolve() : Date.now() > deadline ? reject(new Error('Viewer did not display an image')) : setTimeout(poll, 10);
                poll();
            });
            const result = {before, after: images.map(img => img.naturalWidth), src: currentSrc, index: gallery.index, previewWidth: gallery.image.naturalWidth};
            gallery.destroy();
            return result;
        }`;
        const script = path.join(temporary, 'main.cjs');
        writeFileSync(script, `const {app, BrowserWindow}=require('electron');
            app.disableHardwareAcceleration();
            app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
            app.whenReady().then(async()=>{try {
                const win = new BrowserWindow({show:false, webPreferences:{sandbox:true, backgroundThrottling:false}});
                await win.loadURL('http://127.0.0.1:${server.address().port}/');
                console.log(JSON.stringify(await win.webContents.executeJavaScript('('+${JSON.stringify(browserCase)}+')()')));
                app.exit(0);
            } catch(error) {console.error(error); app.exit(1);}});`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const { stdout } = await promisify(execFile)(process.env.IMG_TEST_ELECTRON, [script], {
            env, windowsHide: true, timeout: 15000,
        });
        assert.deepEqual(JSON.parse(stdout.trim().split('\n').at(-1)), {
            before: 1, after: [3, 3], src: 'assets/测试 image.png', index: 1, previewWidth: 3,
        });
        assert.equal(imageRequests, 3, 'Repeated image references share a reload; the gallery also loads its other image');
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        assert.equal(path.dirname(temporary), tmpdir());
        assert.ok(path.basename(temporary).startsWith('imgreeditor-refresh-'));
        rmSync(temporary, { recursive: true, force: true });
    }
});
