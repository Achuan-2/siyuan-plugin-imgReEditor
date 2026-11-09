const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(resolve(__dirname, '../src/utils/assetImageRefresh.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function loadRefresh(fetch) {
    const module = { exports: {} };
    new Function('module', 'exports', 'fetch', 'console', source)(module, module.exports, fetch, { warn() {} });
    return module.exports.refreshAssetImages;
}

function image(path, src = path) {
    const attributes = new Map([['data-src', path], ['src', src]]);
    return {
        getAttribute: name => attributes.get(name) ?? null,
        setAttribute: (name, value) => attributes.set(name, value),
    };
}

test('reloads one canonical cache entry for repeated images before changing the DOM', async () => {
    const first = image('assets/a.png', 'assets/a.png?t=old');
    const second = image('assets/a.png');
    let finish;
    let calls = 0;
    const refresh = loadRefresh(async (path, options) => {
        calls++;
        assert.equal(path, 'assets/a.png');
        assert.equal(options.cache, 'reload');
        return { ok: true, arrayBuffer: () => new Promise(resolve => { finish = resolve; }) };
    });
    const task = refresh([first, second, first], 'assets/a.png');
    await Promise.resolve();
    assert.equal(first.getAttribute('src'), 'assets/a.png?t=old');
    finish(new ArrayBuffer(0));
    await task;
    assert.equal(calls, 1);
    for (const img of [first, second]) {
        assert.equal(img.getAttribute('src'), 'assets/a.png');
        assert.equal(img.getAttribute('data-src'), 'assets/a.png');
        // SiYuan uses this suffix comparison to select the current preview image.
        assert.ok(img.getAttribute('src').endsWith('assets/a.png'));
    }
});

test('conversion updates both attributes and preserves replacements made while loading', async () => {
    const first = image('assets/a.png');
    const replaced = image('assets/a.png');
    const refresh = loadRefresh(async () => {
        replaced.setAttribute('src', 'assets/user-edit.png');
        replaced.setAttribute('data-src', 'assets/user-edit.png');
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    });
    await refresh([first, replaced], 'assets/a.webp');
    assert.equal(first.getAttribute('src'), 'assets/a.webp');
    assert.equal(first.getAttribute('data-src'), 'assets/a.webp');
    assert.equal(replaced.getAttribute('src'), 'assets/user-edit.png');
    assert.equal(replaced.getAttribute('data-src'), 'assets/user-edit.png');
});

test('assets without visible images do not issue reload requests', async () => {
    await loadRefresh(() => assert.fail('No image needs refreshing'))([], 'assets/a.png');
});

for (const failure of ['network', 'http']) {
    test(`${failure} refresh failure keeps a canonical preview URL without rejecting the save`, async () => {
        const img = image('assets/a.png', 'assets/a.png?t=old');
        await loadRefresh(async () => {
            if (failure === 'network') throw new Error('offline');
            return { ok: false, status: 404 };
        })([img], 'assets/a.png');
        assert.equal(img.getAttribute('src'), 'assets/a.png');
    });
}
