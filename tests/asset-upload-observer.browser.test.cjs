const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ts = require('typescript');

test('network image paste observes real DOM insertion, localization, overlap and cleanup', {
    skip: !process.env.IMG_TEST_ELECTRON,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'imgreeditor-upload-'));
    try {
        const source = ts.transpileModule(readFileSync(path.resolve(__dirname, '../src/utils/assetUploadObserver.ts'), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText;
        const browserCase = async source => {
            const exports = {};
            new Function('exports', source)(exports);
            const wait = () => new Promise(resolve => setTimeout(resolve, 20));
            const equal = (actual, expected) => {
                if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
                }
            };
            const remoteHTML = '<img src="https://remote.invalid/image.png">';
            const image = src => {
                const img = document.createElement('img');
                img.setAttribute('src', src);
                img.setAttribute('data-src', src);
                return img;
            };
            const pathOf = src => src?.startsWith('assets/') ? decodeURIComponent(src) : null;
            const fixture = (initial = []) => {
                const editor = document.createElement('div');
                editor.append(...initial);
                document.body.append(editor);
                const protyle = { block: { rootID: 'doc' }, wysiwyg: { element: editor } };
                const listeners = new Map();
                const bus = {
                    on: (type, listener) => listeners.set(type, listener),
                    off: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
                };
                const emit = (type, detail) => listeners.get(type)?.({ detail });
                const calls = [];
                let enabled = true;
                const stop = exports.observeAssetUploads(bus, () => enabled,
                    async (paths, doc, before) => calls.push({ paths, doc, before }),
                    () => editor.querySelectorAll('img').length, pathOf);
                return {
                    editor, protyle, calls, listeners, emit,
                    paste: (overrides = {}) => emit('paste', {
                        protyle, textHTML: remoteHTML, siyuanHTML: '', files: [], ...overrides,
                    }),
                    disable: () => { enabled = false; },
                    close: () => { stop(); editor.remove(); },
                };
            };
            const checks = [];

            // HTML conversion can return assets directly without any upload event.
            let f = fixture([image('assets/old.png')]);
            f.paste();
            // A recreated old node must not be mistaken for the pasted picture.
            f.editor.replaceChildren(image('assets/old.png'), image('assets/pasted.png'));
            await wait();
            equal(f.calls, [{ paths: ['assets/pasted.png'], doc: 'doc', before: 1 }]);
            f.close();
            checks.push('direct insertion ignores recreated old images');

            // Some host versions first insert a remote img and then change its URL.
            f = fixture();
            f.paste();
            const localized = image('https://remote.invalid/image.png');
            f.editor.append(localized);
            await wait();
            equal(f.calls, []);
            localized.setAttribute('src', 'assets/localized.jpg');
            localized.setAttribute('data-src', 'assets/localized.jpg');
            await wait();
            equal(f.calls, [{ paths: ['assets/localized.jpg'], doc: 'doc', before: 0 }]);
            // A later WebP conversion must not start compression again.
            localized.setAttribute('src', 'assets/localized.webp');
            localized.setAttribute('data-src', 'assets/localized.webp');
            await wait();
            equal(f.calls.length, 1);
            f.paste();
            localized.setAttribute('src', 'assets/later.png');
            localized.setAttribute('data-src', 'assets/later.png');
            await wait();
            equal(f.calls.length, 2);
            f.close();
            checks.push('remote src changes trigger once');

            // Normal clipboard Files belong exclusively to before-upload-assets.
            f = fixture();
            f.paste({ files: [new File(['image'], 'image.png')] });
            f.editor.append(image('assets/file.png'));
            await wait();
            equal(f.calls, []);
            f.close();
            checks.push('clipboard File avoids duplicate network monitoring');

            f = fixture();
            f.paste({ textHTML: remoteHTML + '<img src="data:image/png;base64,AA==">' });
            let complete;
            f.emit('before-upload-assets', {
                protyle: f.protyle, target: 'editor', signal: new AbortController().signal,
                onComplete: callback => { complete = callback; },
            });
            complete({ status: 'success', succFiles: [{ path: 'assets/embedded%20image.png' }] });
            f.editor.append(image('assets/embedded image.png'), image('assets/network.png'));
            await wait();
            equal(f.calls, [
                { paths: ['assets/embedded%20image.png'], doc: 'doc', before: 0 },
                { paths: ['assets/network.png'], doc: 'doc', before: 0 },
            ]);
            f.close();
            checks.push('mixed HTML handles each upload and remote image once');

            f = fixture();
            f.paste();
            f.paste();
            f.editor.append(image('assets/repeated.png'));
            await wait();
            equal(f.calls.length, 1);
            f.editor.append(image('assets/repeated.png'));
            await wait();
            equal(f.calls.length, 2);
            f.close();
            checks.push('overlapping pastes retain separate insertions');

            f = fixture();
            f.paste();
            const otherEditor = document.createElement('div');
            document.body.append(otherEditor);
            otherEditor.append(image('assets/unrelated.png'));
            await wait();
            equal(f.calls, []);
            f.disable();
            f.editor.append(image('assets/disabled.png'));
            await wait();
            equal(f.calls, []);
            f.close();
            otherEditor.remove();
            checks.push('other editors and disabled compression ignored');

            for (const cleanup of ['destroy', 'unload', 'switch-document']) {
                f = fixture();
                f.paste();
                if (cleanup === 'destroy') f.emit('destroy-protyle', { protyle: f.protyle });
                if (cleanup === 'unload') f.close();
                if (cleanup === 'switch-document') f.protyle.block.rootID = 'other-doc';
                f.editor.append(image('assets/canceled.png'));
                await wait();
                equal(f.calls, []);
                f.close();
                equal(f.listeners.size, 0);
            }
            checks.push('destroy unload and document switches cancel observation');
            return checks;
        };
        const script = path.join(temporary, 'main.cjs');
        writeFileSync(script, `const {app, BrowserWindow}=require('electron');
            app.disableHardwareAcceleration();
            app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
            app.whenReady().then(async()=>{try {
                const win = new BrowserWindow({show:false, webPreferences:{sandbox:true, backgroundThrottling:false}});
                win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_request, callback) => callback({cancel:true}));
                await win.loadURL('data:text/html,<!doctype html><body></body>');
                console.log(JSON.stringify(await win.webContents.executeJavaScript('('+${JSON.stringify(browserCase.toString())}+')('+${JSON.stringify(JSON.stringify(source))}+')')));
                app.exit(0);
            } catch(error) {console.error(error); app.exit(1);}});`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const { stdout } = await promisify(execFile)(process.env.IMG_TEST_ELECTRON, [script], {
            env, windowsHide: true, timeout: 15000,
        });
        const checks = JSON.parse(stdout.trim().split('\n').at(-1));
        assert.equal(checks.length, 7);
    } finally {
        assert.equal(path.dirname(temporary), tmpdir());
        assert.ok(path.basename(temporary).startsWith('imgreeditor-upload-'));
        rmSync(temporary, { recursive: true, force: true });
    }
});
