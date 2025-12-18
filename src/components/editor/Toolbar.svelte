<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    export let canUndo: boolean = false;
    export let canRedo: boolean = false;
    export let undoCount: number = 0;
    export let redoCount: number = 0;
    export let active: string | null = null;
    export let activeShape: string | null = null;
    const dispatch = createEventDispatcher();

    function emit(name: string, detail: any = {}) {
        dispatch(name, detail);
    }
</script>

<div class="editor-toolbar">
    <button class="b3-button" class:active={active === 'select'} class:b3-button--outline={active !== 'select'} on:click={() => emit('tool', { tool: 'select' })}>
        选择
    </button>
    <button class="b3-button" class:active={active === 'crop'} class:b3-button--outline={active !== 'crop'} on:click={() => emit('tool', { tool: 'crop' })}>
        裁剪
    </button>
    <div class="shape-group">
        <button
            class="b3-button"
            class:active={active === 'shape' && activeShape === 'rect'}
            class:b3-button--outline={!(active === 'shape' && activeShape === 'rect')}
            on:click={() => emit('tool', { tool: 'shape', shape: 'rect' })}
        >
            矩形
        </button>
        <button
            class="b3-button"
            class:active={active === 'shape' && activeShape === 'circle'}
            class:b3-button--outline={!(active === 'shape' && activeShape === 'circle')}
            on:click={() => emit('tool', { tool: 'shape', shape: 'circle' })}
        >
            圆形
        </button>
    </div>
    <button class="b3-button" class:active={active === 'arrow'} class:b3-button--outline={active !== 'arrow'} on:click={() => emit('tool', { tool: 'arrow' })}>
        箭头
    </button>
    <button class="b3-button" class:active={active === 'text'} class:b3-button--outline={active !== 'text'} on:click={() => emit('tool', { tool: 'text' })}>
        文字
    </button>
    <button class="b3-button" class:active={active === 'brush'} class:b3-button--outline={active !== 'brush'} on:click={() => emit('tool', { tool: 'brush' })}>
        画笔
    </button>
    <button class="b3-button" class:active={active === 'eraser'} class:b3-button--outline={active !== 'eraser'} on:click={() => emit('tool', { tool: 'eraser' })}>
        橡皮
    </button>
    <button
        class="b3-button"
        class:active={active === 'transform'}
        class:b3-button--outline={active !== 'transform'}
        on:click={() => emit('tool', { tool: 'transform' })}
    >
        变换
    </button>
    <button class="b3-button b3-button--outline" on:click={() => emit('undo')} disabled={!canUndo}>
        撤回{#if undoCount > 0}
            ({undoCount}){/if}
    </button>
    <button class="b3-button b3-button--outline" on:click={() => emit('redo')} disabled={!canRedo}>
        恢复{#if redoCount > 0}
            ({redoCount}){/if}
    </button>
    <button class="b3-button b3-button--outline" on:click={() => emit('save')}>保存</button>
    <button class="b3-button b3-button--outline" on:click={() => emit('cancel')}>取消</button>

    <style>
        .editor-toolbar button.active {
            background: #e9f2ff;
            border: 1px solid #bcd8ff;
            box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.02);
        }
    </style>
</div>

<style>
    .editor-toolbar {
        position: sticky;
        top: 0;
        z-index: 60;
        display: flex;
        gap: 6px;
        padding: 8px;
        background: rgba(255, 255, 255, 0.98);
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        align-items: center;
    }
    .editor-toolbar button {
        padding: 6px 8px;
    }
</style>
