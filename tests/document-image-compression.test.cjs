const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function createPlugin(api = {}) {
    const module = { exports: {} };
    const imports = {
        siyuan: { Plugin: class {} }, '@/index.scss': {}, './Settings.svelte': {},
        './components/ImageEditor.svelte': {}, './defaultSettings': {},
        './utils/i18n': { t: key => key, setPluginInstance() {} },
        './ScreenshotManager': {}, './utils/assetUploadObserver': {},
        './utils/assetImageRefresh': {}, './utils': {}, './api': api,
    };
    const document = { createElement: () => ({ remove() {} }) };
    new Function('require', 'module', 'exports', 'document', 'console', source)(name => {
        assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
        return imports[name];
    }, module, module.exports, document, { error() {}, warn() {} });
    return new module.exports.default();
}

function treeRow({ id = 'parent', count, hidden = false, arrowHidden = false, toggle = true } = {}) {
    const attributes = { 'data-node-id': id, 'data-count': count };
    return {
        getAttribute: name => attributes[name] ?? null,
        querySelector: () => toggle ? {
            classList: { contains: name => hidden && name === 'fn__hidden' },
            querySelector: () => ({ classList: { contains: name => arrowHidden && name === 'fn__hidden' } }),
        } : null,
    };
}

function openTreeMenu(plugin, detail = {}) {
    const items = [];
    plugin.openMenuDocTreeHandler({ detail: {
        menu: { addItem: item => items.push(item) },
        type: 'doc', elements: [treeRow()], ...detail,
    } });
    return items;
}

test('a parent document gets its subtree compression entry synchronously without scanning', async () => {
    const plugin = createPlugin();
    const calls = [];
    plugin.openDocumentImageCompression = async (...args) => calls.push(args);
    const items = openTreeMenu(plugin);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'compress-document-tree-images');
    assert.equal(items[0].label, 'documentImageCompression.titleWithChildren');
    assert.deepEqual(calls, []);
    await items[0].click();
    assert.deepEqual(calls, [['parent', undefined, true]]);
});

test('leaf documents, notebooks, multiple selections and missing identities do not get the entry', () => {
    const plugin = createPlugin();
    for (const detail of [
        { elements: [treeRow({ count: '0', hidden: true })] },
        { elements: [treeRow({ count: '0' })] },
        { elements: [treeRow({ arrowHidden: true })] },
        { elements: [treeRow({ toggle: false })] },
        { type: 'notebook' }, { type: 'docs' },
        { elements: [treeRow(), treeRow()] },
        { items: [{ id: 'a' }, { id: 'b' }] },
        { elements: [] }, { elements: [treeRow({ id: '' })] },
        { menu: null },
    ]) {
        assert.equal(openTreeMenu(plugin, detail).length, 0);
    }
});

test('the menu supports legacy child counts and document identities from virtual tree items', async () => {
    const plugin = createPlugin();
    const calls = [];
    plugin.openDocumentImageCompression = async (...args) => calls.push(args);
    assert.equal(openTreeMenu(plugin, { elements: [treeRow({ count: '2', toggle: false })] }).length, 1);
    const items = openTreeMenu(plugin, { items: [{ id: 'virtual-parent' }], elements: [treeRow({ id: '' })] });
    assert.equal(items.length, 1);
    await items[0].click();
    assert.deepEqual(calls, [['virtual-parent', undefined, true]]);
});

test('loading and unloading registers and removes the same document tree event handler', async () => {
    const plugin = createPlugin();
    const listeners = new Map();
    plugin.eventBus = {
        on: (name, handler) => listeners.set(name, handler),
        off(name, handler) {
            assert.equal(listeners.get(name), handler);
            listeners.delete(name);
        },
    };
    plugin.addIcons = plugin.addStatusBar = () => {};
    plugin.loadSettings = async () => ({});
    plugin.applyScreenshotFeatureSettings = async () => {};
    plugin.setupAutomaticImageCompression = plugin.teardownAutomaticImageCompression = () => {};
    await plugin.onload();
    assert.equal(typeof listeners.get('open-menu-doctree'), 'function');
    await plugin.onunload();
    assert.equal(listeners.size, 0);
    assert.equal(plugin._openMenuDocTreeHandler, null);
});

test('all descendant levels are enumerated beyond tree display limits, including hidden documents', async () => {
    const calls = [];
    const children = Array.from({ length: 80 }, (_, index) => ({
        id: `child-${index}`, path: `/parent/child-${index}.sy`, subFileCount: index === 0 ? 1 : 0,
    }));
    const filesByPath = {
        '/parent.sy': children,
        '/parent/child-0.sy': [{ id: 'grandchild', path: '/parent/child-0/grandchild.sy', subFileCount: 1 }],
        '/parent/child-0/grandchild.sy': [children[0]],
    };
    const plugin = createPlugin({
        getBlockByID: async id => ({ id, type: 'd', box: 'notebook', path: '/parent.sy' }),
        request: async (url, body) => {
            calls.push([url, body]);
            assert.ok(Object.hasOwn(filesByPath, body.path), `Unexpected document path: ${body.path}`);
            return { files: filesByPath[body.path] };
        },
    });
    const ids = await plugin.getDocumentAndDescendantIDs('parent');
    assert.deepEqual(ids, ['parent', ...children.map(child => child.id), 'grandchild']);
    assert.equal(calls.length, 3);
    for (const [url, body] of calls) {
        assert.equal(url, '/api/filetree/listDocsByPath');
        assert.equal(body.notebook, 'notebook');
        assert.equal(body.maxListCount, 0);
        assert.equal(body.ignoreMaxListHint, true);
        assert.equal(body.showHidden, true);
    }
});

test('subtree compression includes parent and nested images and compresses shared assets once', async () => {
    const plugin = createPlugin({ pushMsg: async () => {}, pushErrMsg: async () => assert.fail() });
    plugin.getDocumentAndDescendantIDs = async () => ['parent', 'child', 'grandchild'];
    const paths = {
        parent: ['assets/shared.png'],
        child: ['assets/shared.png', 'assets/child.jpg'],
        grandchild: ['assets/grandchild.webp', 'assets/animation.gif'],
    };
    const scanned = [];
    const compressed = [];
    const choice = { outputFormat: 'webp', maxLongEdge: 1600, quality: 0.8 };
    plugin.getDocumentImageAssetPaths = async (id, protyle) => {
        scanned.push([id, protyle]);
        return paths[id];
    };
    plugin.showImageCompressionDialog = async (title, images, confirm) => {
        assert.equal(title, 'documentImageCompression.titleWithChildren');
        assert.deepEqual(images, ['assets/shared.png', 'assets/child.jpg', 'assets/grandchild.webp']);
        await confirm(choice);
    };
    plugin.compressImageAsset = async (path, _image, options) => {
        compressed.push([path, options]);
        return { status: 'skipped', reason: 'not-smaller' };
    };
    await plugin.openDocumentImageCompression('parent', undefined, true);
    assert.deepEqual(scanned, [['parent', undefined], ['child', undefined], ['grandchild', undefined]]);
    assert.deepEqual(compressed, ['assets/shared.png', 'assets/child.jpg', 'assets/grandchild.webp']
        .map(path => [path, { ...choice, silent: true }]));
});

test('the existing title menu still scans only the current document with its live editor', async () => {
    const plugin = createPlugin({ pushMsg: async () => assert.fail(), pushErrMsg: async () => assert.fail() });
    const protyle = { block: { rootID: 'current' } };
    let entry;
    plugin.openEditorTitleIconHandler({ detail: { menu: { addItem: item => { entry = item; } }, protyle } });
    plugin.getDocumentAndDescendantIDs = async () => assert.fail('Single document must not enumerate descendants');
    plugin.getDocumentImageAssetPaths = async (id, editor) => {
        assert.equal(id, 'current');
        assert.equal(editor, protyle);
        return ['assets/current.png'];
    };
    plugin.showImageCompressionDialog = async (title, paths) => {
        assert.equal(title, 'documentImageCompression.title');
        assert.deepEqual(paths, ['assets/current.png']);
    };
    await entry.click();
});

test('empty and unsupported subtree results show messages matching the selected scope', async () => {
    for (const [images, message] of [
        [[], 'documentImageCompression.noLocalImagesWithChildren'],
        [['assets/animation.gif'], 'documentImageCompression.noCompressibleImagesWithChildren'],
    ]) {
        const messages = [];
        const plugin = createPlugin({ pushMsg: async text => messages.push(text), pushErrMsg: async () => assert.fail() });
        plugin.getDocumentAndDescendantIDs = async () => ['parent', 'child'];
        plugin.getDocumentImageAssetPaths = async () => images;
        plugin.showImageCompressionDialog = async () => assert.fail();
        await plugin.openDocumentImageCompression('parent', undefined, true);
        assert.deepEqual(messages, [message]);
    }
});

test('a failed child listing reports the scan failure before offering partial compression', async () => {
    const messages = [];
    const plugin = createPlugin({
        getBlockByID: async () => ({ type: 'd', box: 'notebook', path: '/parent.sy' }),
        request: async () => null,
        pushErrMsg: async text => messages.push(text),
    });
    plugin.getDocumentImageAssetPaths = async () => assert.fail();
    plugin.showImageCompressionDialog = async () => assert.fail();
    await plugin.openDocumentImageCompression('parent', undefined, true);
    assert.deepEqual(messages, ['documentImageCompression.scanFailed']);
});
