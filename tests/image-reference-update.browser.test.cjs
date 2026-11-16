const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ts = require('typescript');

test('manual compression preserves image blocks when gutter buttons share the block ID', {
    skip: !process.env.IMG_TEST_ELECTRON || !process.env.IMG_TEST_LUTE_JS,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'imgreeditor-reference-'));
    try {
        const source = ts.createSourceFile('index.ts', readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf8'),
            ts.ScriptTarget.Latest, true);
        const plugin = source.statements.find(ts.isClassDeclaration);
        const names = new Set(['updateImageElementsWithPathMap', 'replaceImageAssetReferenceInBlock',
            'replaceImageAssetReferencesEverywhere', 'openMenuImageHandler']);
        const methods = plugin.members.filter(node => names.has(node.name?.getText(source)))
            .map(node => node.getText(source)).join('\n');
        const normalize = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'normalizeAssetPath');
        const code = ts.transpileModule(`${normalize.getText(source)}\nclass Fixture { ${methods} }\nmodule.exports = Fixture;`, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText;
        const browserCase = async (code, luteSource) => {
            const check = require('node:assert/strict');
            new Function(luteSource)();
            const lute = Lute.New();
            const id = '20261115120000-abcdefg';
            const original = 'assets/pasted.png';
            const saved = 'assets/pasted.webp';
            const items = new Map();
            const writes = [];
            let stored, failWrite = false, reads = 0, closedStored;
            const closedID = '20261115120000-closed1';
            const api = {
                sql: async stmt => stmt.includes("AND id > ''") ? [
                    { id: 'ref-1', block_id: id, path: original },
                    ...(closedStored ? [{ id: 'ref-2', block_id: closedID, path: original }] : []),
                ] : [],
                getBlockDOM: async blockID => { reads++; return { dom: blockID === closedID ? closedStored : stored }; },
                updateBlock: async (type, html, blockID) => {
                    check.equal(type, 'dom');
                    check.ok(blockID === id || blockID === closedID);
                    writes.push(html);
                    if (failWrite) return null;
                    if (blockID === closedID) closedStored = lute.SpinBlockDOM(html);
                    else stored = lute.SpinBlockDOM(html);
                    return [{}];
                },
                pushErrMsg: message => check.fail(message),
            };
            const module = { exports: {} };
            const t = key => key;
            new Function('require', 'module', 'exports', 't', code)(name => {
                check.equal(name, './api');
                return api;
            }, module, module.exports, t);
            const plugin = new module.exports();
            plugin.settings = { enablePasteImageCompression: false };
            plugin.showImageCompressionDialog = async (_title, _paths, confirm) => confirm({ outputFormat: 'webp' });
            plugin.compressImageAsset = async (_path, image) => {
                // Match compression's preview refresh before the block is persisted.
                image.setAttribute('src', saved);
                image.setAttribute('data-src', saved);
                return { status: 'compressed', originalPath: original, savedPath: saved };
            };
            window.siyuan = { menus: { menu: { addItem: item => items.set(item.id, item) } } };
            const mount = () => {
                const blockDOM = lute.Md2BlockDOM(`before ![caption](${original} "title") after`)
                    .replace(/data-node-id="[^"]+"/, `data-node-id="${id}"`);
                stored = blockDOM;
                document.body.innerHTML = `<div class="protyle-gutters"><button data-node-id="${id}" data-type="NodeParagraph"><svg></svg><span></span></button></div>` +
                    `<div class="protyle-wysiwyg">${blockDOM}</div>`;
                return document.querySelector('.protyle-wysiwyg [data-node-id]');
            };
            const verifySaved = () => {
                const parsed = new DOMParser().parseFromString(stored, 'text/html');
                check.equal(parsed.querySelectorAll('img').length, 1);
                check.equal(parsed.querySelector('img').getAttribute('data-src'), saved);
                const markdown = lute.BlockDOM2StdMd(stored);
                check.ok(markdown.includes(`![caption](${saved} "title")`), markdown);
                check.ok(markdown.includes('before') && markdown.includes('after'), markdown);
                check.ok(!writes.at(-1).startsWith('<button'));
            };

            let block = mount();
            await plugin.openMenuImageHandler({ detail: { element: block.querySelector('[data-type="img"]') } });
            await items.get('compress-image').click();
            verifySaved();
            check.equal(document.querySelector('.protyle-gutters button img'), null);

            // When one document is open in multiple panes, use the clicked pane's text.
            block = mount();
            const otherPane = document.createElement('div');
            otherPane.className = 'protyle-wysiwyg';
            otherPane.innerHTML = stored;
            document.body.insertBefore(otherPane, block.parentElement);
            block.querySelector('[contenteditable="true"]').append(' latest text');
            await plugin.replaceImageAssetReferenceInBlock(id, original, saved, block);
            verifySaved();
            check.ok(lute.BlockDOM2StdMd(stored).includes('latest text'));

            // Do not write a stale image back after the user removes/replaces it.
            for (const replacement of [null, 'assets/other.png']) {
                block = mount();
                const image = block.querySelector('img');
                if (replacement) {
                    image.setAttribute('src', replacement);
                    image.setAttribute('data-src', replacement);
                } else image.closest('[data-type="img"]').remove();
                const count = writes.length;
                await plugin.replaceImageAssetReferenceInBlock(id, original, saved, block);
                check.equal(writes.length, count);
            }

            block = mount();
            failWrite = true;
            await check.rejects(plugin.replaceImageAssetReferenceInBlock(id, original, saved, block), /Unable to save/);
            check.equal(block.querySelector('img').getAttribute('data-src'), original);
            failWrite = false;

            // A closed editor can still update the persisted block, never a gutter.
            mount();
            document.querySelector('.protyle-wysiwyg').remove();
            await plugin.replaceImageAssetReferenceInBlock(id, original, saved);
            verifySaved();
            check.equal(reads, 1);

            // A global conversion also persists all copies in a closed document.
            block = mount();
            closedStored = lute.Md2BlockDOM(`closed ![one](${original}) ![two](${original}?width=300#preview) ![other](assets/other.png)`)
                .replace(/data-node-id="[^"]+"/, `data-node-id="${closedID}"`);
            check.equal(await plugin.replaceImageAssetReferencesEverywhere(original, saved, block), 2);
            verifySaved();
            const closedMarkdown = lute.BlockDOM2StdMd(closedStored);
            check.ok(closedMarkdown.includes(`![one](${saved})`), closedMarkdown);
            check.ok(closedMarkdown.includes(`![two](${saved}?width=300#preview)`), closedMarkdown);
            check.ok(closedMarkdown.includes('![other](assets/other.png)'), closedMarkdown);
            check.ok(closedMarkdown.includes('closed'), closedMarkdown);
            return 'reference update passed';
        };
        const html = path.join(temporary, 'index.html');
        const script = path.join(temporary, 'main.cjs');
        const luteSource = readFileSync(process.env.IMG_TEST_LUTE_JS, 'utf8');
        writeFileSync(html, '<!doctype html><body></body>');
        writeFileSync(script, `const {app, BrowserWindow} = require('electron');
            app.disableHardwareAcceleration();
            app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
            app.whenReady().then(async () => { try {
                const win = new BrowserWindow({show:false, webPreferences:{nodeIntegration:true, contextIsolation:false, sandbox:false}});
                await win.loadFile(${JSON.stringify(html)});
                console.log(await win.webContents.executeJavaScript('(' + ${JSON.stringify(browserCase.toString())} + ')(' +
                    ${JSON.stringify(JSON.stringify(code))} + ',' + ${JSON.stringify(JSON.stringify(luteSource))} + ')'));
                app.exit(0);
            } catch(error) { console.error(error); app.exit(1); } });`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const { stdout } = await promisify(execFile)(process.env.IMG_TEST_ELECTRON, [script], {
            env, windowsHide: true, timeout: 30000,
        });
        assert.ok(stdout.includes('reference update passed'));
    } finally {
        assert.equal(path.dirname(temporary), tmpdir());
        assert.ok(path.basename(temporary).startsWith('imgreeditor-reference-'));
        rmSync(temporary, { recursive: true, force: true });
    }
});
