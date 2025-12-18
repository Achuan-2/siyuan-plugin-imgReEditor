<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    export let tool: string | null = null;
    export let settings: any = {};
    const dispatch = createEventDispatcher();

    function emitChange(partial: any) {
        const next = { ...(settings || {}), ...(partial || {}) };
        dispatch('change', next);
    }

    function getValue(e: Event) {
        return (e.target as HTMLInputElement).value;
    }
    function getChecked(e: Event) {
        return (e.target as HTMLInputElement).checked;
    }

    // font list state
    let fonts: { family: string; fullName: string }[] = [];
    let loadingFonts = true;

    onMount(async () => {
        // candidate fonts to check (common cross-platform + Chinese fonts)
        const candidates = [
            'Microsoft Yahei',
            'PingFang SC',
            'Source Han Sans',
            'Source Han Serif',
            'Arial',
            'Helvetica',
            'Times New Roman',
            'Georgia',
            'Courier New',
            'Noto Sans',
            'Noto Serif',
            'SimHei',
            'SimSun',
            'Roboto',
            'Segoe UI',
        ];

        try {
            if ('queryLocalFonts' in window) {
                const availableFonts = await (window as any).queryLocalFonts();
                // Filter for "Regular" and get family/fullName
                const regularFonts = availableFonts
                    .filter((font: any) => font.style.toLowerCase() === 'regular')
                    .map((font: any) => ({
                        family: font.family,
                        fullName: font.fullName,
                    }));

                if (regularFonts.length > 0) {
                    // Sort by fullName
                    fonts = regularFonts.sort((a, b) => a.fullName.localeCompare(b.fullName));
                } else {
                    fonts = candidates.map(name => ({ family: name, fullName: name }));
                }
            } else {
                fonts = candidates.map(name => ({ family: name, fullName: name }));
            }
        } catch (e) {
            console.warn('queryLocalFonts failed:', e);
            fonts = candidates.map(name => ({ family: name, fullName: name }));
        } finally {
            loadingFonts = false;
        }
    });
</script>

<div class="tool-settings">
    {#if !tool}
        <div class="empty">请选择工具</div>
    {:else if tool === 'shape'}
        <div class="row">
            <label for="stroke-color">描边颜色</label>
            <input
                id="stroke-color"
                type="color"
                value={settings.stroke || '#ff0000'}
                on:input={e => emitChange({ stroke: getValue(e) })}
            />
        </div>
        <div class="row">
            <label for="stroke-width">描边宽度</label>
            <input
                id="stroke-width"
                type="range"
                min="1"
                max="20"
                value={settings.strokeWidth || 2}
                on:input={e => emitChange({ strokeWidth: +getValue(e) })}
            />
            <span class="val">{settings.strokeWidth || 2}</span>
        </div>
        <div class="row">
            <label for="fill-en">填充</label>
            <input
                id="fill-en"
                type="checkbox"
                checked={!!settings.fill}
                on:change={e =>
                    emitChange({ fill: getChecked(e) ? settings.fill || '#ffffff' : null })}
            />
            {#if settings.fill}
                <input
                    id="fill-color"
                    type="color"
                    value={settings.fill}
                    on:input={e => emitChange({ fill: getValue(e) })}
                />
                <div style="">
                    <label for="fill-opacity" style="width:90px;">填充透明度</label>
                    <input
                        id="fill-opacity"
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round((settings.fillOpacity || 1) * 100)}
                        on:input={e => emitChange({ fillOpacity: +getValue(e) / 100 })}
                    />
                    <span class="val">{Math.round((settings.fillOpacity || 1) * 100)}%</span>
                </div>
            {/if}
        </div>
    {:else if tool === 'brush'}
        <div class="row">
            <label for="brush-color">颜色</label>
            <input
                id="brush-color"
                type="color"
                value={settings.stroke || '#ff0000'}
                on:input={e => emitChange({ stroke: getValue(e) })}
            />
        </div>
        <div class="row">
            <label for="brush-size">粗细</label>
            <input
                id="brush-size"
                type="range"
                min="1"
                max="80"
                value={settings.strokeWidth || settings.size || 4}
                on:input={e => emitChange({ strokeWidth: +getValue(e), size: +getValue(e) })}
            />
            <span class="val">{settings.strokeWidth || settings.size || 4}</span>
        </div>
    {:else if tool === 'eraser'}
        <div class="row">
            <label for="eraser-size">粗细</label>
            <input
                id="eraser-size"
                type="range"
                min="1"
                max="100"
                value={settings.strokeWidth || settings.size || 16}
                on:input={e => emitChange({ strokeWidth: +getValue(e), size: +getValue(e) })}
            />
            <span class="val">{settings.strokeWidth || settings.size || 16}</span>
        </div>
    {:else if tool === 'arrow'}
        <div class="row">
            <label for="arrow-color">颜色</label>
            <input
                id="arrow-color"
                type="color"
                value={settings.stroke || '#ff0000'}
                on:input={e => emitChange({ stroke: getValue(e) })}
            />
        </div>
        <div class="row">
            <label for="arrow-width">粗细</label>
            <input
                id="arrow-width"
                type="range"
                min="1"
                max="20"
                value={settings.strokeWidth || 4}
                on:input={e => emitChange({ strokeWidth: +getValue(e) })}
            />
            <span class="val">{settings.strokeWidth || 4}</span>
        </div>
        <div class="row">
            <label for="arrow-head">箭头</label>
            <select
                id="arrow-head"
                value={settings.arrowHead || 'right'}
                on:change={e => emitChange({ arrowHead: getValue(e) })}
            >
                <option value="none">无</option>
                <option value="left">左边</option>
                <option value="right">右边</option>
                <option value="both">两边</option>
            </select>
        </div>
    {:else if tool === 'text'}
        <div class="row">
            <label for="font-family">字体</label>
            <select
                id="font-family"
                value={settings.family ||
                    settings.fontFamily ||
                    (fonts[0] ? fonts[0].family : 'Microsoft Yahei')}
                on:change={e => emitChange({ family: getValue(e) })}
            >
                {#if loadingFonts}
                    <option disabled>检测字体中...</option>
                {:else}
                    {#each fonts as f}
                        <option value={f.family}>{f.fullName}</option>
                    {/each}
                {/if}
            </select>
        </div>
        <div class="row">
            <label for="font-size">字号</label>
            <input
                id="font-size"
                type="range"
                min="8"
                max="120"
                value={settings.size || settings.fontSize || 24}
                on:input={e => emitChange({ size: +getValue(e) })}
            />
            <span class="val">{settings.size || settings.fontSize || 24}</span>
        </div>
        <div class="row">
            <span class="label">样式</span>
            <div style="display:flex;gap:4px;">
                <button
                    class:active={settings.bold}
                    on:click={() => emitChange({ bold: !settings.bold })}
                    style="font-weight:bold; width:32px;"
                    title="加粗"
                >
                    B
                </button>
                <button
                    class:active={settings.italic}
                    on:click={() => emitChange({ italic: !settings.italic })}
                    style="font-style:italic; width:32px;"
                    title="斜体"
                >
                    I
                </button>
            </div>
        </div>
        <div class="row">
            <label for="font-color">颜色</label>
            <input
                id="font-color"
                type="color"
                value={settings.fill || '#000000'}
                on:input={e => emitChange({ fill: getValue(e) })}
            />
        </div>
        <div class="row">
            <label for="font-stroke">描边颜色</label>
            <input
                id="font-stroke"
                type="color"
                value={settings.stroke || '#ffffff'}
                on:input={e => emitChange({ stroke: getValue(e) })}
            />
        </div>
        <div class="row">
            <label for="font-stroke-width">描边粗细</label>
            <input
                id="font-stroke-width"
                type="range"
                min="0"
                max="10"
                step="0.2"
                value={settings.strokeWidth || 0}
                on:input={e => emitChange({ strokeWidth: +getValue(e) })}
            />
            <span class="val">{settings.strokeWidth || 0}</span>
        </div>
    {:else if tool === 'number-marker'}
        <div class="row">
            <label for="num-bg-color">背景颜色</label>
            <input
                id="num-bg-color"
                type="color"
                value={settings.fill || '#ff0000'}
                on:input={e => emitChange({ fill: getValue(e) })}
            />
        </div>
        <div class="row">
            <label for="num-radius">大小</label>
            <input
                id="num-radius"
                type="number"
                min="5"
                max="100"
                value={settings.radius || 15}
                on:input={e => emitChange({ radius: +getValue(e) })}
                style="width: 60px;"
            />
        </div>
        <div class="row">
            <label for="num-count">{settings.isSelection ? '当前编号' : '下个编号'}</label>
            <input
                id="num-count"
                type="number"
                min="1"
                value={settings.count || 1}
                on:input={e => emitChange({ count: +getValue(e) })}
                style="width: 60px;"
            />
        </div>
        {#if settings.isSelection}
            <div class="row">
                <label for="next-num-count">下个编号</label>
                <input
                    id="next-num-count"
                    type="number"
                    min="1"
                    value={settings.nextNumber || 1}
                    on:input={e => emitChange({ nextNumber: +getValue(e) })}
                    style="width: 60px;"
                />
            </div>
        {/if}
    {:else if tool === 'transform'}
        <div class="row">
            <div class="label">翻转</div>
            <div style="display:flex;gap:8px;">
                <button on:click={() => dispatch('action', { action: 'flip', dir: 'horizontal' })}>
                    水平
                </button>
                <button on:click={() => dispatch('action', { action: 'flip', dir: 'vertical' })}>
                    垂直
                </button>
            </div>
        </div>
        <div class="row">
            <div class="label">旋转</div>
            <div style="display:flex;gap:8px;">
                <button on:click={() => dispatch('action', { action: 'rotate', dir: 'cw' })}>
                    顺时针 90°
                </button>
                <button on:click={() => dispatch('action', { action: 'rotate', dir: 'ccw' })}>
                    逆时针 90°
                </button>
            </div>
        </div>
    {:else}
        <div class="empty">暂无设置</div>
    {/if}
</div>

<style>
    .tool-settings {
        padding: 8px;
        width: 240px;
        background: rgba(255, 255, 255, 0.98);
        border-left: 1px solid #eee;
    }
    .empty {
        color: #888;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    }
    .row label,
    .row .label {
        width: 80px;
        font-size: 13px;
        display: inline-block;
    }
    .val {
        width: 30px;
        text-align: center;
    }
    button {
        padding: 4px 8px;
        border: 1px solid #ddd;
        background: #fff;
        cursor: pointer;
        border-radius: 4px;
        font-size: 12px;
        color: #333;
    }
    button:hover {
        background: #f5f5f5;
    }
    button.active {
        background: var(--b3-theme-primary-lightest, #e3f2fd);
        color: var(--b3-theme-primary, #1976d2);
        border-color: var(--b3-theme-primary, #1976d2);
    }
</style>
