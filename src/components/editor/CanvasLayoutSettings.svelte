<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { t } from '../../utils/i18n';
    import { generateId } from '../../utils/uuid';
    import { createMarginGuides, normalizeCanvasLayout, normalizeCanvasPresets } from './canvasLayout';
    import type { CanvasGuide } from './canvasLayout';

    export let settings: any = {};
    export let presets: unknown = [];
    const dispatch = createEventDispatcher();
    let selected = '';
    let name = '';
    let margin = 10;
    $: entries = normalizeCanvasPresets(presets);
    $: guides = normalizeCanvasLayout(settings).guides;

    function changeGuides(next: CanvasGuide[]) {
        dispatch('change', { guides: next, guidesVisible: true });
    }
    function updateGuide(index: number, partial: Partial<CanvasGuide>) {
        changeGuides(guides.map((g, i) => i === index ? { ...g, ...partial } : g));
    }
    function changeDirection(index: number, event: Event) {
        updateGuide(index, { axis: (event.currentTarget as HTMLSelectElement).value as CanvasGuide['axis'] });
    }
    function changePosition(index: number, event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        if (input.value !== '' && input.validity.valid) updateGuide(index, { position: Number(input.value) });
        else input.value = String(guides[index].position);
    }
    function addMargins() {
        const added = createMarginGuides(margin).filter(g =>
            !guides.some(old => old.axis === g.axis && old.position === g.position));
        changeGuides([...guides, ...added]);
    }
    function save() {
        if (!name.trim()) return;
        const existing = entries.find(p => p.name === name.trim());
        const id = existing?.id || generateId();
        const preset = { id, name: name.trim(), layout: normalizeCanvasLayout(settings) };
        dispatch('updatePresets', [...entries.filter(p => p.id !== id), preset]);
        selected = id;
        name = '';
    }
    function load() {
        const preset = entries.find(p => p.id === selected);
        if (preset) dispatch('loadPreset', normalizeCanvasLayout(preset.layout));
    }
    function deletePreset() {
        dispatch('updatePresets', entries.filter(p => p.id !== selected));
        selected = '';
    }
</script>

<div class="layout-settings">
    <details open>
        <summary>{t('canvasLayout.guides')}</summary>
        <label class="visibility"><input type="checkbox" checked={settings.guidesVisible !== false} on:change={e => dispatch('change', { guidesVisible: e.currentTarget.checked })} />{t('canvasLayout.showGuides')}</label>
        {#each guides as guide, index}
            <div class="controls">
                <select value={guide.axis} aria-label={t('canvasLayout.direction')} on:change={e => changeDirection(index, e)}>
                    <option value="horizontal">{t('canvasLayout.horizontal')}</option>
                    <option value="vertical">{t('canvasLayout.vertical')}</option>
                </select>
                <input class="position" type="number" min="0" max="100" step="0.1" value={guide.position} aria-label={t('canvasLayout.position')} on:change={e => changePosition(index, e)} /><span>%</span>
                <button aria-label={t('canvasLayout.deleteGuide')} title={t('canvasLayout.deleteGuide')} on:click={() => changeGuides(guides.filter((_, i) => i !== index))}>×</button>
            </div>
        {/each}
        <div class="controls">
            <button on:click={() => changeGuides([...guides, { axis: 'horizontal', position: 50 }])}>+ {t('canvasLayout.horizontal')}</button>
            <button on:click={() => changeGuides([...guides, { axis: 'vertical', position: 50 }])}>+ {t('canvasLayout.vertical')}</button>
            <button disabled={!guides.length} on:click={() => changeGuides([])}>{t('canvasLayout.clear')}</button>
        </div>
        <div class="controls">
            <label for="canvas-margin">{t('canvasLayout.margin')}</label>
            <input id="canvas-margin" class="position" type="number" min="0.1" max="49.9" step="0.1" bind:value={margin} /><span>%</span>
            <button disabled={!createMarginGuides(margin).length} on:click={addMargins}>{t('canvasLayout.add')}</button>
        </div>
    </details>
    <details>
        <summary>{t('canvasLayout.presets')}</summary>
        <div class="controls">
            <select bind:value={selected} aria-label={t('canvasLayout.presets')}>
                <option value="">{t('canvasLayout.choosePreset')}</option>
                {#each entries as preset}<option value={preset.id}>{preset.name}</option>{/each}
            </select>
            <button disabled={!entries.some(p => p.id === selected)} on:click={load}>{t('canvasLayout.load')}</button>
            <button disabled={!entries.some(p => p.id === selected)} on:click={deletePreset}>{t('canvasLayout.delete')}</button>
        </div>
        <form class="controls" on:submit|preventDefault={save}>
            <input bind:value={name} maxlength="80" placeholder={t('canvasLayout.presetName')} aria-label={t('canvasLayout.presetName')} />
            <button type="submit" disabled={!name.trim()}>{entries.some(p => p.name === name.trim()) ? t('canvasLayout.overwrite') : t('canvasLayout.save')}</button>
        </form>
    </details>
</div>

<style>
    .layout-settings { margin: 12px 0; }
    details { border-top: 1px solid var(--b3-border-color); padding: 10px 0; }
    summary { cursor: pointer; margin-bottom: 8px; }
    .controls { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
    .controls select, .controls input:not(.position) { flex: 1; min-width: 0; width: 0; }
    .position { width: 56px; min-width: 0; }
    input, select, button { font: inherit; color: inherit; padding: 4px 6px; border: 1px solid var(--b3-border-color); border-radius: 4px; background: var(--b3-theme-background); }
    button { cursor: pointer; white-space: nowrap; }
    button:disabled { opacity: .5; cursor: default; }
    .visibility { display: flex; align-items: center; gap: 6px; }
</style>
