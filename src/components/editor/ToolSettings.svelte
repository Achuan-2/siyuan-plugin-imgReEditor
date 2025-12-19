<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    import ColorPicker from './ColorPicker.svelte';
    export let tool: string | null = null;
    export let settings: any = {};
    export let recentColors: Record<string, string[]> = {};
    export let selectCanvasSizeMode: boolean = false;
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
                <ColorPicker
                    colorKey={`shape-${settings.shape || 'rect'}-fill`}
                    value={settings.fill}
                    {recentColors}
                    on:change={e => emitChange({ fill: e.detail })}
                    on:recentUpdate
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
                type="range"
                min="1"
                max="50"
                value={settings.strokeWidth || 4}
                on:input={e => emitChange({ strokeWidth: +getValue(e) })}
            />
            <span class="val">{settings.strokeWidth || 4}</span>
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
            <span class="val">{settings.strokeWidth || 0}</span>
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
            <label>裁剪</label>
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
                value={settings.fill || '#f1f5fd'}
                {recentColors}
                on:change={e => emitChange({ fill: e.detail })}
                on:recentUpdate
            />
        </div>
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
    {:else if tool === 'canvas'}
        <div class="row">
            <label for="canvas-width">画布宽度</label>
            <input
                id="canvas-width"
                type="number"
                min="100"
                max="5000"
                value={settings.width || 800}
                on:input={e => emitChange({ width: +getValue(e) })}
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
                on:input={e => emitChange({ height: +getValue(e) })}
                style="width: 80px;"
            />
        </div>
        <div class="row" style="gap: 8px;">
            <button
                on:click={() =>
                    dispatch('action', {
                        action: 'resizeCanvas',
                        width: settings.width || 800,
                        height: settings.height || 600,
                    })}
            >
                应用大小
            </button>
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
</style>
