<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    export let canUndo: boolean = false;
    export let canRedo: boolean = false;
    export let undoCount: number = 0;
    export let redoCount: number = 0;
    export let active: string | null = null;
    export let activeShape: string | null = null;
    export let isCanvasMode: boolean = false;
    const dispatch = createEventDispatcher();

    function emit(name: string, detail: any = {}) {
        dispatch(name, detail);
    }
</script>

<div class="editor-toolbar">
    <button
        class="b3-button"
        class:active={active === 'hand'}
        class:b3-button--outline={active !== 'hand'}
        on:click={() => emit('tool', { tool: 'hand' })}
        title="手型工具"
    >
        <svg class="icon" viewBox="0 0 24 24">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
            <path
                d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.83L7 15"
            />
        </svg>
    </button>
    <button
        class="b3-button"
        class:active={active === 'select'}
        class:b3-button--outline={active !== 'select'}
        on:click={() => emit('tool', { tool: 'select' })}
        title="选择工具"
    >
        <svg class="icon" viewBox="0 0 24 24">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            <path d="M13 13l6 6" />
        </svg>
    </button>
    {#if !isCanvasMode}
        <button
            class="b3-button"
            class:active={active === 'crop'}
            class:b3-button--outline={active !== 'crop'}
            on:click={() => emit('tool', { tool: 'crop' })}
            title="裁剪工具"
        >
            <svg class="icon" viewBox="0 0 24 24">
                <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15" />
                <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15" />
                <line x1="9" y1="9" x2="15" y2="15" />
                <line x1="15" y1="9" x2="9" y2="15" />
            </svg>
        </button>
    {/if}
    <div class="shape-group">
        <button
            class="b3-button"
            class:active={active === 'shape' && activeShape === 'rect'}
            class:b3-button--outline={!(active === 'shape' && activeShape === 'rect')}
            on:click={() => emit('tool', { tool: 'shape', shape: 'rect' })}
            title="矩形"
        >
            <svg class="icon" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            </svg>
        </button>
        <button
            class="b3-button"
            class:active={active === 'shape' && activeShape === 'circle'}
            class:b3-button--outline={!(active === 'shape' && activeShape === 'circle')}
            on:click={() => emit('tool', { tool: 'shape', shape: 'circle' })}
            title="圆形"
        >
            <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>
        </button>
    </div>
    <button
        class="b3-button"
        class:active={active === 'arrow'}
        class:b3-button--outline={active !== 'arrow'}
        on:click={() => emit('tool', { tool: 'arrow' })}
        title="箭头"
    >
        <svg class="icon" viewBox="0 0 24 24">
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
        </svg>
    </button>
    <button
        class="b3-button"
        class:active={active === 'number-marker'}
        class:b3-button--outline={active !== 'number-marker'}
        on:click={() => emit('tool', { tool: 'number-marker' })}
        title="数字标记"
    >
        <svg class="icon" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <text x="12" y="16" text-anchor="middle" font-size="12" fill="currentColor">1</text>
        </svg>
    </button>
    <button
        class="b3-button"
        class:active={active === 'text'}
        class:b3-button--outline={active !== 'text'}
        on:click={() => emit('tool', { tool: 'text' })}
        title="文本"
    >
        <svg class="icon" viewBox="0 0 24 24">
            <path d="M4 7V4h16v3" />
            <path d="M9 20h6" />
            <path d="M12 4v16" />
        </svg>
    </button>
    <button
        class="b3-button"
        class:active={active === 'brush'}
        class:b3-button--outline={active !== 'brush'}
        on:click={() => emit('tool', { tool: 'brush' })}
        title="画笔"
    >
        <svg class="fill-icon" viewBox="0 0 1024 1024">
            <path
                d="M173.013333 882.56l72.106667-203.733333L741.546667 132.266667 789.333333 129.92l76.373334 69.333333 2.346666 47.786667-496.64 546.773333z m109.44-181.333333l-35.84 101.76 99.2-44.586667 478.72-526.933333v-12.586667l-50.773333-45.44h-12.373333z"
            />
            <path
                d="M678.229333 202.026667l126.336 114.752-28.693333 31.573333-126.336-114.730667z"
            />
        </svg>
    </button>
    <button
        class="b3-button"
        class:active={active === 'eraser'}
        class:b3-button--outline={active !== 'eraser'}
        on:click={() => emit('tool', { tool: 'eraser' })}
        title="橡皮擦"
    >
        <svg class="fill-icon" viewBox="0 0 1024 1024">
            <path
                d="M980.9 424.1c12.5-12.5 12.5-32.8 0-45.3L636.7 34.6c-12.5-12.5-32.8-12.5-45.3 0L90.5 535.5c-50 50-50 131 0 181l272 270.3c24 23.8 56.4 37.2 90.2 37.2H864c17.7 0 32-14.3 32-32 0-8.8-3.6-16.8-9.4-22.6-5.8-5.8-13.8-9.4-22.6-9.4H599.5c-57 0-85.6-68.9-45.3-109.3l426.7-426.6zM434.8 879.7c-25 25-65.5 25-90.5 0L135.8 671.3c-25-25-25-65.5 0-90.5l127.9-127.9 299 299-127.9 127.8z"
            />
        </svg>
    </button>
    {#if !isCanvasMode}
        <button
            class="b3-button"
            class:active={active === 'mosaic'}
            class:b3-button--outline={active !== 'mosaic'}
            on:click={() => emit('tool', { tool: 'mosaic' })}
            title="马赛克"
        >
            <svg class="fill-icon" viewBox="0 0 1024 1024">
                <path
                    d="M853.323294 712.794353h-140.528941v140.528941h140.528941zM572.235294 712.794353h-140.559059v140.528941H572.235294zM291.147294 712.794353H150.588235v140.528941h140.559059zM853.323294 431.676235h-140.528941V572.235294h140.528941zM572.235294 431.676235h-140.559059V572.235294H572.235294zM291.147294 431.676235H150.588235V572.235294h140.559059zM853.323294 150.588235h-140.528941v140.559059h140.528941zM572.235294 150.588235h-140.559059v140.559059H572.235294zM291.147294 150.588235H150.588235v140.559059h140.559059zM431.676235 291.147294H291.147294v140.528941h140.528941zM431.676235 572.235294H291.147294v140.559059h140.528941zM712.794353 291.147294H572.235294v140.528941h140.559059zM712.794353 572.235294H572.235294v140.559059h140.559059z"
                ></path>
            </svg>
        </button>
    {/if}
    {#if !isCanvasMode}
        <button
            class="b3-button"
            class:active={active === 'image-border'}
            class:b3-button--outline={active !== 'image-border'}
            on:click={() => emit('tool', { tool: 'image-border' })}
            title="图片边框"
        >
            <svg class="icon" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <rect x="7" y="7" width="10" height="10" rx="1" ry="1" />
            </svg>
        </button>
    {/if}
    {#if isCanvasMode}
        <button
            class="b3-button"
            class:active={active === 'canvas'}
            class:b3-button--outline={active !== 'canvas'}
            on:click={() => emit('tool', { tool: 'canvas' })}
            title="画布设置"
        >
            <svg class="icon" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke-dasharray="4" />
                <path d="M21 3L15 3" />
                <path d="M3 21L3 15" />
            </svg>
        </button>
    {/if}
    {#if !isCanvasMode}
        <button
            class="b3-button"
            class:active={active === 'transform'}
            class:b3-button--outline={active !== 'transform'}
            on:click={() => emit('tool', { tool: 'transform' })}
            title="变换"
        >
            <svg class="fill-icon" viewBox="0 0 1024 1024">
                <path d="M1024 0v1024H0V0z" fill="#FFFFFF" fill-opacity=".01" />
                <path
                    d="M948.363636 386.327273c45.917091 19.828364 33.186909 87.156364-15.080727 90.368l-3.607273 0.116363H121.274182a47.150545 47.150545 0 0 1-47.034182-43.659636l-0.139636-3.490909V80.826182c0-32.744727 32.349091-55.156364 62.603636-44.567273l3.258182 1.256727L948.363636 386.350545z m-18.688 160.861091c50.013091 0 65.000727 66.885818 21.946182 88.925091l-3.258182 1.536L139.938909 986.461091a47.173818 47.173818 0 0 1-65.722182-39.842909l-0.116363-3.467637V594.385455c0-24.878545 19.246545-45.242182 43.636363-47.034182l3.537455-0.139637h808.401454z m-228.328727-164.724364L168.424727 152.552727v229.911273h532.922182z m0 259.048727H168.424727v229.911273l532.922182-229.911273z"
                />
            </svg>
        </button>
    {/if}
    <button
        class="b3-button"
        class:active={active === 'align'}
        class:b3-button--outline={active !== 'align'}
        on:click={() => emit('tool', { tool: 'align' })}
        title="对齐/分布"
    >
        <svg class="icon" viewBox="0 0 24 24">
            <path d="M3 3h18" />
            <path d="M3 7h12" />
            <path d="M3 11h18" />
            <path d="M3 15h12" />
            <path d="M3 19h18" />
        </svg>
    </button>
    <button
        class="b3-button b3-button--outline"
        on:click={() => emit('undo')}
        disabled={!canUndo}
        title="撤销"
    >
        <svg class="icon" viewBox="0 0 24 24">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
    </button>
    <button
        class="b3-button b3-button--outline"
        on:click={() => emit('redo')}
        disabled={!canRedo}
        title="重做"
    >
        <svg class="icon" viewBox="0 0 24 24">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
        </svg>
    </button>
    <div class="toolbar-spacer"></div>
    <button class="b3-button b3-button--outline" on:click={() => emit('save')} title="保存">
        <svg class="icon" viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17,21 17,13 7,13 7,21" />
            <polyline points="7,3 7,8 15,8" />
        </svg>
    </button>
    <button class="b3-button b3-button--outline" on:click={() => emit('cancel')} title="取消">
        <svg class="icon" viewBox="0 0 24 24">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
        </svg>
    </button>

    <style>
    </style>
</div>

<style>
    .icon {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
    }
    .fill-icon {
        width: 16px;
        height: 16px;
        fill: currentColor;
        stroke: none;
    }
    .editor-toolbar {
        position: sticky;
        top: 0;
        z-index: 60;
        display: flex;
        gap: 6px;
        padding: 8px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        align-items: center;
    }
    .toolbar-spacer {
        flex: 1 1 auto;
    }
    .editor-toolbar button {
        padding: 6px 8px;
    }
</style>
