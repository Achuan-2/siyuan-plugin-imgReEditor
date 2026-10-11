<script lang="ts">
    import { createEventDispatcher, tick } from 'svelte';
    import { t } from '../../utils/i18n';
    import { generateId } from '../../utils/uuid';
    import {
        TEXT_STYLE_PRESETS, getTextStylePresetOptions, getTextStylePresetPreview,
        captureTextTemplateStyle, normalizeCustomTextTemplates, getTextTemplatePreview,
        textTemplateMatches,
    } from './textStylePresets';

    export let settings: any = {};
    export let customTemplates: unknown = [];
    const dispatch = createEventDispatcher();
    let container: HTMLElement;
    let dropdown: HTMLDetailsElement;
    let nameInput: HTMLInputElement;
    let preferredId = '';
    let showSaveForm = false;
    let templateName = '';

    $: fontSize = settings.size || settings.fontSize || 24;
    $: saved = normalizeCustomTextTemplates(customTemplates);
    $: entries = [
        ...TEXT_STYLE_PRESETS.map(preset => ({
            id: preset.id, name: t(`editor.textTemplateNames.${preset.id}`), custom: false,
            options: getTextStylePresetOptions(preset, fontSize), preview: getTextStylePresetPreview(preset),
        })),
        ...saved.map(template => ({
            id: template.id, name: template.name, custom: true,
            options: { ...template.style, textStylePreset: template.id },
            preview: getTextTemplatePreview(template.style, fontSize),
        })),
    ];
    $: selected = entries.find(entry => entry.id === preferredId && textTemplateMatches(settings, entry.options))
        || entries.find(entry => entry.id === settings.textStylePreset && textTemplateMatches(settings, entry.options))
        || entries.find(entry => textTemplateMatches(settings, entry.options));

    function selectTemplate(entry: typeof entries[number]) {
        preferredId = entry.id;
        dropdown.open = false;
        dispatch('change', entry.options);
    }

    async function startSaving() {
        dropdown.open = false;
        templateName = `${t('editor.newTextTemplateName')} ${saved.length + 1}`;
        showSaveForm = true;
        await tick();
        nameInput?.focus();
        nameInput?.select();
    }

    function saveTemplate() {
        const name = templateName.trim();
        if (!name) return;
        const template = { id: `custom-${generateId()}`, name: name.slice(0, 60), style: captureTextTemplateStyle(settings) };
        preferredId = template.id;
        dispatch('updateCustomTemplates', [...saved, template]);
        showSaveForm = false;
    }

    function deleteTemplate() {
        if (!selected?.custom) return;
        dispatch('updateCustomTemplates', saved.filter(template => template.id !== selected.id));
        preferredId = '';
        dropdown.open = false;
    }

    function closeOutside(event: MouseEvent) {
        if (dropdown?.open && !container?.contains(event.target as Node)) dropdown.open = false;
    }
</script>

<svelte:window on:click={closeOutside} on:keydown={event => {
    if (event.key === 'Escape') {
        if (dropdown?.open) { dropdown.open = false; dropdown.querySelector('summary')?.focus(); }
        showSaveForm = false;
    }
}} />

<div class="text-templates" bind:this={container}>
    <div class="template-label" id="text-template-label">{t('editor.textTemplates')}</div>
    <details class="template-dropdown" bind:this={dropdown}>
        <summary aria-labelledby="text-template-label" on:mousedown={event => event.preventDefault()}>
            <span class="template-preview" aria-hidden="true" style={selected?.preview || getTextTemplatePreview(settings, fontSize)}>{t('editor.textTemplatePreview')}</span>
            <span class="template-name">{selected?.name || t('editor.currentTextStyle')}</span>
            <span class="dropdown-arrow" aria-hidden="true">▾</span>
        </summary>
        <div class="template-menu">
            {#each [false, true] as custom}
                {#if !custom || saved.length > 0}
                    <div class="template-group-label">{t(custom ? 'editor.customTextTemplates' : 'editor.builtinTextTemplates')}</div>
                    {#each entries.filter(entry => entry.custom === custom) as entry (entry.id)}
                        <button type="button" class="template-option" class:active={selected?.id === entry.id}
                            title={entry.name} aria-pressed={selected?.id === entry.id}
                            on:mousedown={event => event.preventDefault()} on:click={() => selectTemplate(entry)}>
                            <span class="template-preview" aria-hidden="true" style={entry.preview}>{t('editor.textTemplatePreview')}</span>
                            <span class="template-name">{entry.name}</span>
                        </button>
                    {/each}
                {/if}
            {/each}
        </div>
    </details>
    <div class="template-actions">
        <button type="button" on:click={startSaving}>{t('editor.saveTextTemplate')}</button>
        <button type="button" disabled={!selected?.custom} on:click={deleteTemplate}>{t('editor.deleteTextTemplate')}</button>
    </div>
    {#if showSaveForm}
        <form class="template-save-form" on:submit|preventDefault={saveTemplate}>
            <input bind:this={nameInput} bind:value={templateName} maxlength="60" required
                aria-label={t('editor.textTemplateName')} placeholder={t('editor.textTemplateName')} />
            <div class="template-actions">
                <button type="submit" disabled={!templateName.trim()}>{t('editor.saveTextTemplateConfirm')}</button>
                <button type="button" on:click={() => showSaveForm = false}>{t('editor.cancelTextTemplate')}</button>
            </div>
        </form>
    {/if}
</div>

<style>
    .text-templates { margin-bottom: 12px; }
    .template-label { font-size: 13px; margin-bottom: 6px; }
    .template-dropdown { position: relative; }
    summary, .template-option {
        display: flex; align-items: center; gap: 8px; padding: 6px 8px;
        width: 100%; box-sizing: border-box; cursor: pointer;
        border: 1px solid var(--b3-border-color, #ddd); border-radius: 4px;
        color: var(--b3-theme-on-surface, #333); background: var(--b3-theme-surface, #fff);
    }
    summary { list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary:focus-visible, button:focus-visible { outline: 2px solid var(--b3-theme-primary, #1976d2); outline-offset: 2px; }
    .template-preview {
        display: inline-block; flex-shrink: 0;
        font: 20px/1.5 'Microsoft YaHei', sans-serif;
    }
    .template-name { flex: 1; min-width: 0; font-size: 12px; overflow-wrap: anywhere; text-align: left; }
    .dropdown-arrow { flex-shrink: 0; }
    .template-menu {
        position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 45;
        max-height: 320px; overflow-y: auto; padding: 4px;
        background: var(--b3-theme-surface, #fff); border: 1px solid var(--b3-border-color, #ddd);
        border-radius: 6px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
    }
    .template-group-label { padding: 4px; font-size: 11px; color: var(--b3-theme-on-surface-light, #888); }
    .template-option { border-color: transparent; margin-bottom: 2px; }
    .template-option:hover, .template-option.active { border-color: var(--b3-theme-primary, #1976d2); }
    .template-actions { display: flex; gap: 6px; margin-top: 6px; }
    button {
        padding: 4px 8px; border: 1px solid var(--b3-border-color, #ddd); border-radius: 4px;
        font-size: 12px; color: var(--b3-theme-on-surface, #333);
        background: var(--b3-theme-surface, #fff); cursor: pointer;
    }
    button:disabled { opacity: 0.45; cursor: default; }
    .template-save-form { margin-top: 8px; }
    input {
        width: 100%; box-sizing: border-box; padding: 4px 6px;
        color: var(--b3-theme-on-surface, #333); background: var(--b3-theme-surface, #fff);
        border: 1px solid var(--b3-border-color, #ddd); border-radius: 4px;
    }
</style>
