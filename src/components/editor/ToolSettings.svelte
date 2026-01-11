<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    import ColorPicker from './ColorPicker.svelte';
    import GradientDesigner from './GradientDesigner.svelte';
    export let tool: string | null = null;
    export let settings: any = {};
    export let recentColors: Record<string, string[]> = {};
    export let savedGradients: string[] = [];
    export let selectCanvasSizeMode: boolean = false;
    const dispatch = createEventDispatcher();

    function emitChange(partial: any) {
        dispatch('change', partial);
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

    // font search / dropdown state
    let fontSearch: string = '';
    let showFontDropdown = false;
    let highlightedIndex = -1;
    let fontInputFocused = false;
    let showGradientDesigner = false;
    let showCanvasGradientDesigner = false;

    $: isGradient =
        typeof settings.fill === 'string' && settings.fill.startsWith('linear-gradient');

    $: filteredFonts =
        (fontSearch || '').trim() === ''
            ? fonts
            : fonts.filter(f => {
                  const text = (f.family + ' ' + (f.fullName || '')).toLowerCase();
                  const terms = fontSearch.trim().toLowerCase().split(/\s+/);
                  return terms.every(t => text.indexOf(t) !== -1);
              });

    function selectFont(f: { family: string; fullName: string }) {
        emitChange({ family: f.family });
        fontSearch = f.fullName || f.family;
        showFontDropdown = false;
        highlightedIndex = -1;
    }

    function handleFontKeydown(e: KeyboardEvent) {
        if (!showFontDropdown) return;
        if (e.key === 'ArrowDown') {
            highlightedIndex = Math.min(highlightedIndex + 1, filteredFonts.length - 1);
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            highlightedIndex = Math.max(highlightedIndex - 1, 0);
            e.preventDefault();
        } else if (e.key === 'Enter') {
            if (highlightedIndex >= 0 && filteredFonts[highlightedIndex]) {
                selectFont(filteredFonts[highlightedIndex]);
                e.preventDefault();
            }
        } else if (e.key === 'Escape') {
            showFontDropdown = false;
            highlightedIndex = -1;
        }
    }

    // 判断字符串中是否包含中文字符
    function isChinese(text: string | undefined | null) {
        if (!text) return false;
        return /[\u4e00-\u9fff]/.test(text);
    }

    // keep fontSearch in sync when settings.family changes externally
    // but avoid overwriting while the user is typing (input focused)
    $: if (!fontInputFocused) {
        if (settings.family) {
            const matched = fonts.find(f => f.family === settings.family);
            fontSearch = matched ? matched.fullName || matched.family : settings.family;
        } else if (!settings.family) {
            // if no family set, clear only when not focused
            fontSearch = '';
        }
    }

    // When focus is inside the tool settings, block propagation of
    // various events to avoid affecting the canvas — unless Ctrl is held.
    function shouldAllowPropagation(e: Event) {
        const evAny = e as any;
        // Allow when Ctrl is held (e.g., Ctrl+C / Ctrl+V)
        if (evAny.ctrlKey) return true;

        // Allow when the event target is an input/textarea or contenteditable
        const target = e.target as HTMLElement | null;
        if (!target) return false;
        const tag = target.tagName && target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return true;
        if ((target as HTMLElement).isContentEditable) return true;
        // also allow if inside an input/textarea/contenteditable ancestor
        if (typeof target.closest === 'function') {
            const anc = target.closest('input, textarea, [contenteditable="true"]');
            if (anc) return true;
        }
        return false;
    }

    function handleInsideKey(e: KeyboardEvent) {
        if (!shouldAllowPropagation(e)) e.stopPropagation();
    }

    function handleInsideMouse(e: MouseEvent) {
        if (!shouldAllowPropagation(e)) e.stopPropagation();
    }

    function handleInsideWheel(e: WheelEvent) {
        if (!shouldAllowPropagation(e)) e.stopPropagation();
    }

    const borderFillPresets = [
        { label: 'Cloudy Knelson', value: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' },
        { label: 'Winter Neva', value: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)' },
        { label: 'Lady Lips', value: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' },
        { label: 'Sunny Morning', value: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
        { label: 'Dusty Grass', value: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)' },
        { label: 'Low Tide', value: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)' },
        { label: 'Royal Purple', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
        { label: 'Deep Blue', value: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)' },
        { label: 'Spiky', value: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
        { label: 'Gentle Care', value: 'linear-gradient(135deg, #ffc3a0 0%, #ffafbd 100%)' },
    ];

    export let defaultsMigrated = false;

    onMount(async () => {
        // One-time migration to ensure defaults are present and deletable
        if (!defaultsMigrated) {
            const defaultValues = borderFillPresets.map(p => p.value);
            dispatch('initDefaults', defaultValues);
        }

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
            'Segoe UI',
        ];
        try {
            if ('queryLocalFonts' in window) {
                const availableFonts = await (window as any).queryLocalFonts();
                // 不再按 style 过滤，直接映射所有本地字体并去重、排序
                const localFonts = (availableFonts || [])
                    .map((font: any) => ({
                        family: font.family,
                        fullName: font.fullName || font.family,
                    }))
                    // 去掉空项
                    .filter((f: any) => f.family)
                    // 去重（按 family）
                    .reduce((acc: any[], cur: any) => {
                        if (!acc.some(f => f.family === cur.family)) acc.push(cur);
                        return acc;
                    }, []);

                if (localFonts.length > 0) {
                    fonts = localFonts.sort((a, b) => a.fullName.localeCompare(b.fullName));
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

    // lock aspect-ratio handling: 当勾选时，修改宽度会自动调整高度以保持比例
    let lockCanvasRatio: boolean = false;
    let lockedAspectRatio: number | null = null; // width / height

    function toggleLockAspect(checked: boolean) {
        lockCanvasRatio = checked;
        if (lockCanvasRatio) {
            const w = settings.width || 800;
            const h = settings.height || 600;
            lockedAspectRatio = w / h;
        } else {
            lockedAspectRatio = null;
        }
    }

    function emitResize(width: number, height: number) {
        dispatch('action', { action: 'resizeCanvas', width, height });
    }

    function handleWidthInput(e: Event) {
        const w = Math.max(1, Math.round(+getValue(e)));
        let h = settings.height || 600;
        if (lockCanvasRatio && lockedAspectRatio) {
            h = Math.max(1, Math.round(w / lockedAspectRatio));
            emitChange({ width: w, height: h });
        } else {
            emitChange({ width: w });
        }
        emitResize(w, h);
    }

    function handleHeightInput(e: Event) {
        const h = Math.max(1, Math.round(+getValue(e)));
        let w = settings.width || 800;
        if (lockCanvasRatio && lockedAspectRatio) {
            w = Math.max(1, Math.round(h * lockedAspectRatio));
            emitChange({ width: w, height: h });
        } else {
            emitChange({ height: h });
        }
        emitResize(w, h);
    }

    // keep locked ratio in sync if settings change externally
    $: if (lockCanvasRatio && settings && settings.width && settings.height) {
        lockedAspectRatio = settings.width / settings.height;
    }
</script>

<div
    class="tool-settings"
    role="region"
    aria-label="工具设置"
    on:keydown={handleInsideKey}
    on:keyup={handleInsideKey}
    on:keypress={handleInsideKey}
    on:mousedown={handleInsideMouse}
    on:wheel={handleInsideWheel}
>
    {#if !tool}
        <div class="empty">请选择工具</div>
    {:else if tool === 'shape'}
        <div class="row">
            <label for="stroke-color">描边颜色</label>
            <ColorPicker
                colorKey={`shape-${settings.shape || 'rect'}-stroke`}
                value={settings.stroke || '#ff0000'}
                {recentColors}
                on:change={e => emitChange({ stroke: e.detail })}
                on:recentUpdate
            />
        </div>
        <div class="row">
            <label for="stroke-width">描边宽度</label>
            <input
                id="stroke-width"
                type="number"
                min="1"
                max="100"
                value={settings.strokeWidth || 2}
                on:input={e => emitChange({ strokeWidth: +getValue(e) })}
            />
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
                <ColorPicker
                    colorKey={`shape-${settings.shape || 'rect'}-fill`}
                    value={settings.fill}
                    {recentColors}
                    on:change={e => emitChange({ fill: e.detail })}
                    on:recentUpdate
                />
            {/if}
        </div>
        {#if settings.fill}
            <div class="row">
                <label for="fill-opacity">填充透明度</label>
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
    {:else if tool === 'brush'}
        <div class="row">
            <label for="brush-color">颜色</label>
            <ColorPicker
                colorKey="brush-color"
                value={settings.stroke || '#ff0000'}
                {recentColors}
                on:change={e => emitChange({ stroke: e.detail })}
                on:recentUpdate
            />
        </div>
        <div class="row">
            <label for="brush-size">粗细</label>
            <input
                id="brush-size"
                type="number"
                min="1"
                max="100"
                value={settings.strokeWidth || settings.size || 4}
                on:input={e => emitChange({ strokeWidth: +getValue(e), size: +getValue(e) })}
            />
        </div>
    {:else if tool === 'eraser'}
        <div class="row">
            <label for="eraser-size">粗细</label>
            <input
                id="eraser-size"
                type="number"
                min="1"
                max="100"
                value={settings.strokeWidth || settings.size || 16}
                on:input={e => emitChange({ strokeWidth: +getValue(e), size: +getValue(e) })}
            />
        </div>
    {:else if tool === 'arrow'}
        <div class="row">
            <label for="arrow-color">颜色</label>
            <ColorPicker
                colorKey="arrow-color"
                value={settings.stroke || '#ff0000'}
                {recentColors}
                on:change={e => emitChange({ stroke: e.detail })}
                on:recentUpdate
            />
        </div>
        <div class="row">
            <label for="arrow-width">粗细</label>
            <input
                id="arrow-width"
                type="number"
                min="1"
                max="50"
                value={settings.strokeWidth || 4}
                on:input={e => emitChange({ strokeWidth: +getValue(e) })}
            />
        </div>
        <div class="row">
            <label for="arrow-head">箭头位置</label>
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
        <div class="row">
            <label for="arrow-head-style">箭头样式</label>
            <select
                id="arrow-head-style"
                value={settings.headStyle || 'sharp'}
                on:change={e => emitChange({ headStyle: getValue(e) })}
            >
                <option value="sharp">尖箭头</option>
                <option value="swallowtail">燕尾箭头</option>
                <option value="sharp-hollow">尖箭头空心</option>
                <option value="swallowtail-hollow">燕尾箭头空心</option>
            </select>
        </div>
        <div class="row">
            <label for="arrow-line-style">线段样式</label>
            <select
                id="arrow-line-style"
                value={settings.lineStyle || 'solid'}
                on:change={e => emitChange({ lineStyle: getValue(e) })}
            >
                <option value="solid">实线</option>
                <option value="dashed">均匀虚线</option>
                <option value="dotted">点线</option>
                <option value="dash-dot">线点线</option>
            </select>
        </div>
        <div class="row">
            <label for="arrow-thickness-style">线段粗细</label>
            <select
                id="arrow-thickness-style"
                value={settings.thicknessStyle || 'uniform'}
                on:change={e => emitChange({ thicknessStyle: getValue(e) })}
            >
                <option value="uniform">均匀</option>
                <option value="varying">变化</option>
            </select>
        </div>
    {:else if tool === 'text'}
        <div class="row">
            <label for="font-family">字体</label>
            <div style="position:relative; width:60%;">
                <input
                    id="font-family"
                    type="text"
                    placeholder="搜索字体（空格为 AND）"
                    value={fontSearch}
                    on:input={e => {
                        fontSearch = getValue(e);
                        showFontDropdown = true;
                        highlightedIndex = -1;
                    }}
                    on:focus={() => {
                        showFontDropdown = true;
                        highlightedIndex = -1;
                        fontInputFocused = true;
                    }}
                    on:blur={() => {
                        showFontDropdown = false;
                        highlightedIndex = -1;
                        fontInputFocused = false;
                    }}
                    on:keydown={handleFontKeydown}
                    disabled={loadingFonts}
                    style="width:100%; font-family: {settings.family ||
                        settings.fontFamily ||
                        (fonts[0] ? fonts[0].family : 'Microsoft Yahei')};"
                />

                {#if showFontDropdown}
                    <ul class="font-dropdown" role="listbox">
                        {#if loadingFonts}
                            <li class="disabled">检测字体中...</li>
                        {:else}
                            {#each filteredFonts as f, i}
                                <li
                                    role="option"
                                    aria-selected={settings.family === f.family}
                                    class:selected={settings.family === f.family}
                                    class:highlight={i === highlightedIndex}
                                    on:mousedown={() => selectFont(f)}
                                >
                                    <span style="font-family: {f.family}">
                                        {f.fullName && isChinese(f.fullName)
                                            ? f.fullName
                                            : f.family}
                                    </span>
                                </li>
                            {/each}
                        {/if}
                    </ul>
                {/if}
            </div>
        </div>
        <div class="row">
            <label for="font-size">字号</label>
            <input
                id="font-size"
                type="number"
                min="8"
                max="120"
                value={settings.size || settings.fontSize || 24}
                on:input={e => emitChange({ size: +getValue(e) })}
            />
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
            <ColorPicker
                colorKey="text-fill"
                value={settings.fill || '#000000'}
                {recentColors}
                on:change={e => emitChange({ fill: e.detail })}
                on:recentUpdate
            />
        </div>
        <div class="row">
            <label for="font-stroke">描边颜色</label>
            <ColorPicker
                colorKey="text-stroke"
                value={settings.stroke || '#ffffff'}
                {recentColors}
                on:change={e => emitChange({ stroke: e.detail })}
                on:recentUpdate
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
        </div>
    {:else if tool === 'number-marker'}
        <div class="row">
            <label for="num-bg-color">背景颜色</label>
            <ColorPicker
                colorKey="number-marker-fill"
                value={settings.fill || '#ff0000'}
                {recentColors}
                on:change={e => emitChange({ fill: e.detail })}
                on:recentUpdate
            />
        </div>
        <div class="row">
            <label for="num-fontsize">字体大小</label>
            <input
                id="num-fontsize"
                type="number"
                min="8"
                max="80"
                value={settings.fontSize || 20}
                on:input={e => emitChange({ fontSize: +getValue(e) })}
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
    {:else if tool === 'crop'}
        <div class="row">
            <span class="label">裁剪</span>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button
                        class:active={settings.cropRatioLabel === 'none'}
                        on:click={() =>
                            dispatch('action', { action: 'setCropRatio', label: 'none' })}
                    >
                        无比例
                    </button>
                    <button
                        class:active={settings.cropRatioLabel === '1:1'}
                        on:click={() =>
                            dispatch('action', { action: 'setCropRatio', label: '1:1' })}
                    >
                        1:1
                    </button>
                    <button
                        class:active={settings.cropRatioLabel === '3:4'}
                        on:click={() =>
                            dispatch('action', { action: 'setCropRatio', label: '3:4' })}
                    >
                        3:4
                    </button>
                    <button
                        class:active={settings.cropRatioLabel === '4:3'}
                        on:click={() =>
                            dispatch('action', { action: 'setCropRatio', label: '4:3' })}
                    >
                        4:3
                    </button>
                    <button
                        class:active={settings.cropRatioLabel === '9:16'}
                        on:click={() =>
                            dispatch('action', { action: 'setCropRatio', label: '9:16' })}
                    >
                        9:16
                    </button>
                    <button
                        class:active={settings.cropRatioLabel === '16:9'}
                        on:click={() =>
                            dispatch('action', { action: 'setCropRatio', label: '16:9' })}
                    >
                        16:9
                    </button>
                </div>
                <div style="display:flex;gap:8px;">
                    <button on:click={() => dispatch('action', { action: 'applyCrop' })}>
                        应用
                    </button>
                </div>
            </div>
        </div>
    {:else if tool === 'image-border'}
        <div class="row">
            <label for="border-enabled">启用图片边框</label>
            <input
                id="border-enabled"
                type="checkbox"
                checked={settings.enabled !== false}
                on:change={e => emitChange({ enabled: getChecked(e) })}
            />
        </div>
        <div class="row">
            <label for="border-bg-color">背景颜色</label>
            <ColorPicker
                colorKey="image-border-fill"
                value={typeof settings.fill === 'string' &&
                settings.fill.startsWith('linear-gradient')
                    ? '#ffffff'
                    : settings.fill || '#f1f5fd'}
                {recentColors}
                on:change={e => emitChange({ fill: e.detail })}
                on:recentUpdate
            />
        </div>
        <div class="row" style="margin-top: -4px; margin-bottom: 12px;">
            <div class="presets">
                {#each savedGradients as grad}
                    <div class="saved-preset-wrapper">
                        <button
                            class="preset-btn"
                            class:active={settings.fill === grad}
                            style="background: {grad}"
                            title={grad}
                            on:click={() => {
                                emitChange({ fill: grad });
                            }}
                        />
                        <button
                            class="preset-delete-btn"
                            title="删除"
                            on:click|stopPropagation={() => {
                                const newSaved = savedGradients.filter(g => g !== grad);
                                dispatch('updateSavedGradients', newSaved);
                            }}
                        >
                            ×
                        </button>
                    </div>
                {/each}
                <button
                    class="preset-btn custom-btn"
                    class:active={showGradientDesigner}
                    title="设计渐变"
                    on:click={() => (showGradientDesigner = !showGradientDesigner)}
                >
                    🎨
                </button>
            </div>
        </div>

        {#if showGradientDesigner}
            <div class="row designer-row">
                <GradientDesigner
                    value={isGradient ? settings.fill : borderFillPresets[0].value}
                    {recentColors}
                    {savedGradients}
                    on:change={e => emitChange({ fill: e.detail })}
                    on:recentUpdate
                    on:updateSavedGradients={e => dispatch('updateSavedGradients', e.detail)}
                />
            </div>
        {/if}
        <div class="row">
            <label for="border-margin">边框间距</label>
            <input
                id="border-margin"
                type="range"
                min="0"
                max="200"
                value={settings.margin || 69}
                on:input={e => emitChange({ margin: +getValue(e) })}
            />
            <span class="val">{settings.margin || 69}</span>
        </div>
        <div class="row">
            <label for="border-radius">图片圆角</label>
            <input
                id="border-radius"
                type="range"
                min="0"
                max="100"
                value={settings.radius || 0}
                on:input={e => emitChange({ radius: +getValue(e) })}
            />
            <span class="val">{settings.radius || 0}</span>
        </div>
        <div class="row">
            <label for="border-outer-radius">边框圆角</label>
            <input
                id="border-outer-radius"
                type="range"
                min="0"
                max="100"
                value={settings.outerRadius || 0}
                on:input={e => emitChange({ outerRadius: +getValue(e) })}
            />
            <span class="val">{settings.outerRadius || 0}</span>
        </div>
        <div class="row">
            <label for="border-shadow">阴影大小</label>
            <input
                id="border-shadow"
                type="range"
                min="0"
                max="100"
                value={settings.shadowBlur || 20}
                on:input={e => emitChange({ shadowBlur: +getValue(e) })}
            />
            <span class="val">{settings.shadowBlur || 20}</span>
        </div>
        <div class="row">
            <label for="border-shadow-color">阴影颜色</label>
            <ColorPicker
                colorKey="image-border-shadow-color"
                value={settings.shadowColor || '#000000'}
                {recentColors}
                on:change={e => emitChange({ shadowColor: e.detail })}
                on:recentUpdate
            />
        </div>
        <div class="row">
            <label for="border-shadow-opacity">阴影透明度</label>
            <input
                id="border-shadow-opacity"
                type="range"
                min="0"
                max="100"
                value={Math.round((settings.shadowOpacity || 0.2) * 100)}
                on:input={e => emitChange({ shadowOpacity: +getValue(e) / 100 })}
            />
            <span class="val">{Math.round((settings.shadowOpacity || 0.2) * 100)}%</span>
        </div>
    {:else if tool === 'mosaic'}
        <div class="row">
            <label for="mosaic-size">马赛克大小</label>
            <input
                id="mosaic-size"
                type="range"
                min="1"
                max="50"
                value={settings.blockSize || 5}
                on:input={e => emitChange({ blockSize: +getValue(e) })}
            />
            <span class="val">{settings.blockSize || 15}</span>
        </div>
    {:else if tool === 'image'}
        {#if settings.isSelection}
            <div class="row">
                <label for="img-width">宽度</label>
                <input
                    id="img-width"
                    type="number"
                    value={settings.width}
                    on:input={e => emitChange({ width: +getValue(e) })}
                    style="width: 80px;"
                />
                <span class="val">px</span>
            </div>
            <div class="row">
                <label for="img-height">高度</label>
                <input
                    id="img-height"
                    type="number"
                    value={settings.height}
                    on:input={e => emitChange({ height: +getValue(e) })}
                    style="width: 80px;"
                />
                <span class="val">px</span>
            </div>
            <div class="row">
                <label for="img-lock-ratio">锁定比例</label>
                <input
                    id="img-lock-ratio"
                    type="checkbox"
                    checked={settings.lockAspectRatio !== false}
                    on:change={e => emitChange({ lockAspectRatio: getChecked(e) })}
                />
            </div>
            <div class="row">
                <button
                    class="b3-button b3-button--outline"
                    on:click={() => dispatch('action', { action: 'enterImageCropMode' })}
                    style="width: 100%;"
                >
                    裁剪图片
                </button>
            </div>
            <div
                class="row"
                style="border-top: 1px solid rgba(0,0,0,0.06); padding-top: 12px; margin-top: 4px;"
            ></div>
        {/if}
        <div class="row">
            <button
                class="b3-button b3-button--outline"
                on:click={() => dispatch('action', { action: 'uploadImage' })}
                style="width: 100%;"
            >
                上传并添加图片
            </button>
        </div>
    {:else if tool === 'canvas'}
        <div class="row">
            <label for="lock-canvas-ratio">固定宽高比例</label>
            <input
                id="lock-canvas-ratio"
                type="checkbox"
                checked={lockCanvasRatio}
                on:change={e => toggleLockAspect(getChecked(e))}
            />
        </div>

        <div class="row">
            <label for="canvas-width">画布宽度</label>
            <input
                id="canvas-width"
                type="number"
                min="100"
                max="5000"
                value={settings.width || 800}
                on:input={handleWidthInput}
                style="width: 80px;"
            />
        </div>
        <div class="row">
            <label for="canvas-height">画布高度</label>
            <input
                id="canvas-height"
                type="number"
                min="100"
                max="5000"
                value={settings.height || 600}
                on:input={handleHeightInput}
                style="width: 80px;"
            />
        </div>
        <div class="row">
            <label for="canvas-bg-color">背景颜色</label>
            <ColorPicker
                colorKey="canvas-fill"
                value={typeof settings.fill === 'string' &&
                settings.fill.startsWith('linear-gradient')
                    ? '#ffffff'
                    : settings.fill || '#ffffff'}
                {recentColors}
                on:change={e => emitChange({ fill: e.detail })}
                on:recentUpdate
            />
        </div>
        <div class="row" style="margin-top: -4px; margin-bottom: 12px;">
            <div class="presets">
                {#each borderFillPresets as p}
                    <button
                        class="preset-btn"
                        class:active={settings.fill === p.value}
                        style="background: {p.value}"
                        title={p.label}
                        on:click={() => {
                            emitChange({ fill: p.value });
                        }}
                    />
                {/each}
                <button
                    class="preset-btn custom-btn"
                    class:active={showCanvasGradientDesigner}
                    title="设计渐变"
                    on:click={() => (showCanvasGradientDesigner = !showCanvasGradientDesigner)}
                >
                    🎨
                </button>
            </div>
        </div>

        {#if showCanvasGradientDesigner}
            <div class="row designer-row">
                <GradientDesigner
                    value={isGradient ? settings.fill : borderFillPresets[0].value}
                    {recentColors}
                    {savedGradients}
                    on:change={e => emitChange({ fill: e.detail })}
                    on:recentUpdate
                    on:updateSavedGradients={e => dispatch('updateSavedGradients', e.detail)}
                />
            </div>
        {/if}

        <div class="row" style="gap: 8px;">
            <button
                on:click={() => dispatch('action', { action: 'selectCanvasSize' })}
                class:active={selectCanvasSizeMode}
                class:resize-active={selectCanvasSizeMode}
            >
                调整大小
            </button>
            <button on:click={() => dispatch('action', { action: 'uploadImage' })}>上传图片</button>
        </div>
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
    {:else if tool === 'align'}
        <div class="align-grid">
            <!-- Row 1: Horizontal align -->
            <button
                class="icon-btn"
                title="左对齐"
                on:click={() =>
                    dispatch('action', { action: 'align', type: 'h-left', forceCanvas: false })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="3" y="4" width="4" height="4" rx="1" />
                    <rect x="3" y="10" width="10" height="4" rx="1" />
                    <rect x="3" y="16" width="16" height="4" rx="1" />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="水平居中"
                on:click={() =>
                    dispatch('action', { action: 'align', type: 'h-center', forceCanvas: false })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="7" y="4" width="10" height="4" rx="1" />
                    <rect x="5" y="10" width="14" height="4" rx="1" />
                    <rect x="3" y="16" width="18" height="4" rx="1" />
                    <line
                        x1="12"
                        y1="2"
                        x2="12"
                        y2="22"
                        stroke="currentColor"
                        stroke-width="0.5"
                        stroke-opacity="0.6"
                    />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="右对齐"
                on:click={() =>
                    dispatch('action', { action: 'align', type: 'h-right', forceCanvas: false })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="17" y="4" width="4" height="4" rx="1" />
                    <rect x="11" y="10" width="10" height="4" rx="1" />
                    <rect x="5" y="16" width="16" height="4" rx="1" />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="以画布水平居中对齐"
                on:click={() =>
                    dispatch('action', { action: 'align', type: 'h-center', forceCanvas: true })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="7" y="6" width="10" height="12" rx="1" fill-opacity="0.06" />
                    <line
                        x1="12"
                        y1="2"
                        x2="12"
                        y2="22"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.6"
                    />
                </svg>
            </button>

            <!-- Row 2: Vertical align -->
            <button
                class="icon-btn"
                title="顶对齐"
                on:click={() =>
                    dispatch('action', { action: 'align', type: 'v-top', forceCanvas: false })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="4" y="3" width="4" height="4" rx="1" />
                    <rect x="10" y="3" width="4" height="10" rx="1" />
                    <rect x="16" y="3" width="4" height="16" rx="1" />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="垂直居中"
                on:click={() =>
                    dispatch('action', { action: 'align', type: 'v-middle', forceCanvas: false })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="4" y="7" width="4" height="10" rx="1" />
                    <rect x="10" y="5" width="4" height="14" rx="1" />
                    <rect x="16" y="3" width="4" height="18" rx="1" />
                    <line
                        x1="2"
                        y1="12"
                        x2="22"
                        y2="12"
                        stroke="currentColor"
                        stroke-width="0.5"
                        stroke-opacity="0.6"
                    />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="底对齐"
                on:click={() =>
                    dispatch('action', { action: 'align', type: 'v-bottom', forceCanvas: false })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="4" y="17" width="4" height="4" rx="1" />
                    <rect x="10" y="11" width="4" height="10" rx="1" />
                    <rect x="16" y="5" width="4" height="16" rx="1" />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="以画布垂直居中对齐"
                on:click={() =>
                    dispatch('action', { action: 'align', type: 'v-middle', forceCanvas: true })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="6" y="7" width="12" height="10" rx="1" fill-opacity="0.06" />
                    <line
                        x1="2"
                        y1="12"
                        x2="22"
                        y2="12"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.6"
                    />
                </svg>
            </button>

            <!-- Row 3: Horizontal distribute -->
            <button
                class="icon-btn"
                title="水平分布（左对齐）"
                on:click={() => dispatch('action', { action: 'distribute', type: 'h-left' })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <!-- long lines at left edges -->
                    <line
                        x1="8"
                        y1="3"
                        x2="8"
                        y2="21"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="9" y="7" width="4" height="10" rx="1" />
                    <line
                        x1="14"
                        y1="3"
                        x2="14"
                        y2="21"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="15" y="7" width="4" height="10" rx="1" />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="水平分布（中心对齐）"
                on:click={() => dispatch('action', { action: 'distribute', type: 'h-center' })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <!-- long lines at centers -->
                    <line
                        x1="8"
                        y1="3"
                        x2="8"
                        y2="21"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="6" y="7" width="4" height="10" rx="1" />
                    <line
                        x1="16"
                        y1="3"
                        x2="16"
                        y2="21"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="14" y="7" width="4" height="10" rx="1" />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="水平分布（右对齐）"
                on:click={() => dispatch('action', { action: 'distribute', type: 'h-right' })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <!-- long lines at right edges -->
                    <rect x="5" y="7" width="4" height="10" rx="1" />
                    <line
                        x1="10"
                        y1="3"
                        x2="10"
                        y2="21"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="13" y="7" width="4" height="10" rx="1" />
                    <line
                        x1="18"
                        y1="3"
                        x2="18"
                        y2="21"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="水平等距"
                on:click={() => dispatch('action', { action: 'distribute', type: 'h-even' })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="3" y="6" width="4" height="12" rx="1" />
                    <rect x="10" y="6" width="4" height="12" rx="1" />
                    <rect x="17" y="6" width="4" height="12" rx="1" />
                    <line x1="0" y1="3" x2="24" y2="3" stroke="none" />
                </svg>
            </button>

            <!-- Row 4: Vertical distribute -->
            <button
                class="icon-btn"
                title="垂直分布（顶部对齐）"
                on:click={() => dispatch('action', { action: 'distribute', type: 'v-top' })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <!-- horizontal long lines at top edges -->
                    <line
                        x1="3"
                        y1="8"
                        x2="21"
                        y2="8"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="7" y="9" width="10" height="4" rx="1" />
                    <line
                        x1="3"
                        y1="14"
                        x2="21"
                        y2="14"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="7" y="15" width="10" height="4" rx="1" />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="垂直分布（居中对齐）"
                on:click={() => dispatch('action', { action: 'distribute', type: 'v-center' })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <!-- horizontal long lines at centers -->
                    <line
                        x1="3"
                        y1="8"
                        x2="21"
                        y2="8"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="7" y="5" width="10" height="4" rx="1" />
                    <line
                        x1="3"
                        y1="12"
                        x2="21"
                        y2="12"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="7" y="11" width="10" height="4" rx="1" />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="垂直分布（底部对齐）"
                on:click={() => dispatch('action', { action: 'distribute', type: 'v-bottom' })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <!-- horizontal long lines at bottom edges -->
                    <rect x="7" y="3" width="10" height="4" rx="1" />
                    <line
                        x1="3"
                        y1="8"
                        x2="21"
                        y2="8"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                    <rect x="7" y="11" width="10" height="4" rx="1" />
                    <line
                        x1="3"
                        y1="16"
                        x2="21"
                        y2="16"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-opacity="0.9"
                    />
                </svg>
            </button>
            <button
                class="icon-btn"
                title="垂直等距"
                on:click={() => dispatch('action', { action: 'distribute', type: 'v-even' })}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <rect x="6" y="3" width="12" height="4" rx="1" />
                    <rect x="6" y="10" width="12" height="4" rx="1" />
                    <rect x="6" y="17" width="12" height="4" rx="1" />
                </svg>
            </button>
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
    .align-grid {
        padding: 8px;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        align-items: center;
        justify-items: center;
    }
    .icon-btn {
        padding: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 36px;
        border-radius: 6px;
    }
    .icon-btn svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 1;
    }
    button.active {
        background: var(--b3-theme-primary-lightest, #e3f2fd);
        color: var(--b3-theme-primary, #1976d2);
        border-color: var(--b3-theme-primary, #1976d2);
    }
    /* 专用于“调整大小”按钮的激活样式：纯蓝背景白字 */
    button.resize-active {
        background: var(--b3-theme-primary, #1976d2);
        color: #ffffff;
        border-color: var(--b3-theme-primary, #1976d2);
    }

    /* font dropdown */
    .font-dropdown {
        position: absolute;
        top: 38px;
        left: 0;
        right: 0;
        max-height: 220px;
        overflow: auto;
        background: #fff;
        border: 1px solid #e6e6e6;
        border-radius: 6px;
        padding: 6px 0;
        z-index: 40;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
    }
    .font-dropdown li {
        list-style: none;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 13px;
        white-space: nowrap;
    }
    .font-dropdown li.disabled {
        color: #888;
        cursor: default;
    }
    .font-dropdown li.highlight {
        background: #f3f7ff;
    }
    .font-dropdown li.selected {
        background: var(--b3-theme-primary-lightest, #e8f0ff);
        color: var(--b3-theme-primary, #1976d2);
    }

    /* presets */
    .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 6px;
        background: #fbfbfb;
        border-radius: 8px;
        border: 1px solid #f0f0f0;
        margin-left: 88px;
        width: 140px;
    }
    .preset-btn {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        padding: 0;
        border: 2px solid #fff;
        box-shadow: 0 0 0 1px #eee;
        transition:
            transform 0.2s,
            box-shadow 0.2s;
        flex-shrink: 0;
    }
    .preset-btn:hover {
        transform: scale(1.15);
        z-index: 1;
    }
    .preset-btn.active {
        box-shadow: 0 0 0 2px var(--b3-theme-primary, #1976d2);
    }
    .preset-btn.custom-btn {
        background: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
    }
    .designer-row {
        margin-bottom: 16px;
        padding-left: 8px;
        display: block;
    }
    .saved-preset-wrapper {
        position: relative;
        width: 20px;
        height: 20px;
        flex-shrink: 0;
    }
    .preset-delete-btn {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ff4d4f;
        color: #fff;
        border: none;
        font-size: 8px;
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        z-index: 2;
    }
    .saved-preset-wrapper:hover .preset-delete-btn {
        display: flex;
    }
</style>
