const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { compile: compileSvelte } = require('svelte/compiler');

const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helperModule = { exports: {} };
new Function('require', 'module', 'exports', compile(readFileSync(
    resolve(__dirname, '../src/components/editor/textStylePresets.ts'), 'utf8'
)))(require, helperModule, helperModule.exports);
const helpers = helperModule.exports;
const componentSource = readFileSync(resolve(__dirname, '../src/components/editor/TextTemplates.svelte'), 'utf8');
const componentScript = componentSource.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const dictionary = require('../i18n/zh_CN.json');
const translate = key => key.split('.').reduce((value, part) => value?.[part], dictionary) ?? key;

function loadTemplates(settings = {}, templates = []) {
    const events = [];
    let counter = 0;
    const refresh = componentScript.match(/^    \$: [\s\S]*?(?=\n    function selectTemplate)/m)[0]
        .replace(/^    \$: /gm, '    ');
    const source = componentScript.replace(/^    \$: (\w+) =/gm, '    let $1 =') + `
        module.exports = {
            configure(options, templates) { settings = options; customTemplates = templates; ${refresh} },
            startSaving, deleteTemplate,
            saveAs(name) { templateName = name; saveTemplate(); },
            choose(id) { selectTemplate(entries.find(entry => entry.id === id)); },
            getState: () => ({ entries, selected, showSaveForm, templateName, dropdown }),
            setup() { dropdown = { open: true }; nameInput = { focus() {}, select() {} }; }
        };
    `;
    const module = { exports: {} };
    const imports = {
        svelte: { createEventDispatcher: () => (name, detail) => events.push({ name, detail }), tick: async () => {} },
        '../../utils/i18n': { t: translate },
        '../../utils/uuid': { generateId: () => `fixture-${++counter}` },
        './textStylePresets': helpers,
    };
    new Function('require', 'module', 'exports', compile(source))(
        name => imports[name], module, module.exports
    );
    module.exports.setup();
    module.exports.configure(settings, templates);
    return { ...module.exports, events };
}

test('default and unfilled templates preview transparently and reset styled text', () => {
    for (const preset of helpers.TEXT_STYLE_PRESETS) {
        const preview = helpers.getTextStylePresetPreview(preset);
        assert.equal(preview.includes('background:transparent;'), !preset.background);
        assert.ok(!preview.includes('#626262'));
    }
    const component = loadTemplates({ fill: '#ff0000', bold: true, textBackgroundEnabled: true });
    component.choose('default');
    const options = component.events.at(-1).detail;
    assert.equal(options.fill, '#000000');
    assert.equal(options.bold, false);
    assert.equal(options.textStrokeStrength, 0);
    assert.equal(options.textShadowEnabled, false);
    assert.equal(options.textBackgroundEnabled, false);
    assert.equal(Object.hasOwn(options, 'size'), false);
    assert.equal(component.getState().dropdown.open, false);
});

test('custom templates save style only and are reusable after settings serialization', async () => {
    const current = { family: 'Arial', size: 64, text: 'Never save content', left: 42,
        bold: true, fill: '#ff0000', textStrokeStrength: 4, textBackgroundEnabled: true,
        textBackgroundFill: '#ff0000', textBackgroundOpacity: 0.5, textBackgroundRadiusPercent: 40,
        textShadowEnabled: true, textShadowColor: '#111111', textShadowOffsetX: -3 };
    const component = loadTemplates(current);
    await component.startSaving();
    assert.equal(component.getState().showSaveForm, true);
    component.saveAs('  我的文字样式  ');
    const event = component.events.at(-1);
    assert.equal(event.name, 'updateCustomTemplates');
    const [template] = event.detail;
    assert.equal(template.name, '我的文字样式');
    assert.equal(template.style.family, 'Arial');
    assert.equal(template.style.fill, '#ff0000');
    for (const key of ['size', 'fontSize', 'text', 'left', 'textStylePreset']) {
        assert.equal(Object.hasOwn(template.style, key), false);
    }
    current.fill = '#000000';
    assert.equal(template.style.fill, '#ff0000');
    const reloaded = loadTemplates({}, JSON.parse(JSON.stringify(event.detail)));
    reloaded.choose(template.id);
    const applied = reloaded.events.at(-1).detail;
    assert.equal(applied.family, 'Arial');
    assert.equal(applied.fill, '#ff0000');
    assert.equal(applied.textShadowOffsetX, -3);
    assert.equal(applied.textBackgroundRadiusPercent, 40);
    assert.equal(applied.textStylePreset, template.id);
    assert.ok(reloaded.getState().entries.at(-1).preview.includes('background:rgba(255,0,0,0.5)'));
});

test('deleting a custom template preserves the applied style and cannot delete built-ins', () => {
    const saved = [{ id: 'custom-fixture', name: 'Example', style: helpers.captureTextTemplateStyle({ fill: '#ee0000' }) }];
    const current = { ...saved[0].style, textStylePreset: saved[0].id };
    const component = loadTemplates(current, saved);
    component.deleteTemplate();
    assert.deepEqual(component.events, [{ name: 'updateCustomTemplates', detail: [] }]);
    assert.equal(current.fill, '#ee0000');
    component.configure({}, []);
    component.choose('default');
    component.events.length = 0;
    component.deleteTemplate();
    assert.deepEqual(component.events, []);
});

test('the parent stores custom templates through its existing save-settings event', () => {
    const source = readFileSync(resolve(__dirname, '../src/components/ImageEditor.svelte'), 'utf8');
    const handler = source.match(/on:updateCustomTemplates=\{(e => \{[\s\S]*?\n\s*\})\}/)[1];
    const settings = { recentColors: { fill: ['#111111'] } };
    const events = [];
    const onUpdate = new Function('settings', 'dispatch', `return (${handler});`)(settings,
        (name, detail) => events.push({ name, detail }));
    const templates = [{ id: 'custom-test', name: 'Saved', style: { fill: '#ffffff' } }];
    onUpdate({ detail: templates });
    assert.equal(events[0].name, 'saveSettings');
    assert.equal(events[0].detail.customTextTemplates, templates);
    assert.deepEqual(settings.recentColors, { fill: ['#111111'] });
    assert.deepEqual(JSON.parse(JSON.stringify(events[0].detail)).customTextTemplates, templates);
});

test('the real dropdown markup renders template names and previews with custom templates', () => {
    const javascriptSource = componentSource.replace(/<script lang="ts">[\s\S]*?<\/script>/,
        `<script>${ts.transpileModule(componentScript, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText}</script>`);
    const compiled = compileSvelte(javascriptSource, { generate: 'ssr' }).js.code;
    const module = { exports: {} };
    const imports = {
        '../../utils/i18n': { t: translate }, '../../utils/uuid': { generateId: () => 'fixture' },
        './textStylePresets': helpers,
    };
    new Function('require', 'module', 'exports', compile(compiled))(
        name => imports[name] || require(name), module, module.exports
    );
    const rendered = module.exports.default.render({ settings: {}, customTemplates: [
        { id: 'custom-example', name: '我的模板', style: helpers.captureTextTemplateStyle({ fill: '#f00000' }) },
    ] }).html;
    for (const text of ['文字模板', '默认', '内置模板', '自定义模板', '我的模板', 'background:transparent;']) {
        assert.ok(rendered.includes(text), text);
    }
    assert.ok(rendered.includes('<details'));
    assert.ok(!rendered.includes('封面文字样式'));
});

test('templates store relative stroke strength and preview it consistently at different font sizes', () => {
    const preset = helpers.TEXT_STYLE_PRESETS.find(item => item.id === 'whiteOutline');
    const small = helpers.getTextStylePresetOptions(preset, 24);
    const large = helpers.getTextStylePresetOptions(preset, 96);
    assert.equal(small.textStrokeStrength, 2);
    assert.equal(large.textStrokeStrength, 2);
    const smallStroke = helpers.getTextTemplatePreview(small, 24).match(/-webkit-text-stroke:[^;]+/)[0];
    const largeStroke = helpers.getTextTemplatePreview(large, 96).match(/-webkit-text-stroke:[^;]+/)[0];
    assert.equal(smallStroke, largeStroke);
    const saved = helpers.captureTextTemplateStyle({ textStrokeStrength: 2, size: 96 });
    assert.equal(saved.textStrokeStrength, 2);
    assert.equal(Object.hasOwn(saved, 'strokeWidth'), false);
    const restored = helpers.normalizeCustomTextTemplates(JSON.parse(JSON.stringify([
        { id: 'custom-strength', name: 'Outline', style: saved },
    ])))[0];
    assert.equal(restored.style.textStrokeStrength, 2);
    const legacy = helpers.captureTextTemplateStyle({ strokeWidth: 4, size: 48 });
    assert.equal(legacy.textStrokeStrength, 2);
});
