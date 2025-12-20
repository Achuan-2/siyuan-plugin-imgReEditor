<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    import ColorPicker from 'svelte-awesome-color-picker';

    export let value: string | null = '#ff0000';
    export let colorKey: string = 'default'; // unique key for this color picker to store recent colors
    export let recentColors: Record<string, string[]> = {}; // passed from parent, keyed by colorKey
    export let maxRecent: number = 8;

    const dispatch = createEventDispatcher();

    let showPopup = false;
    let showAwesomePicker = false;

    // Default color palette
    const defaultColors = [
        '#ff0000',
        '#ff6600',
        '#ffcc00',
        '#33cc33',
        '#00ccff',
        '#0066ff',
        '#9933ff',
        '#ff33cc',
        '#ffffff',
        '#cccccc',
        '#666666',
        '#000000',
    ];

    // Get recent colors for this picker
    $: myRecentColors = (recentColors && recentColors[colorKey]) || [];

    $: displayValue = value || '#ff0000';

    function selectColor(color: string) {
        if (!color || typeof color !== 'string') return;
        value = color;
        dispatch('change', color);
        addToRecent(color);
        showPopup = false;
    }

    const isSameColor = (c1: any, c2: any) => {
        if (!c1 || !c2 || typeof c1 !== 'string' || typeof c2 !== 'string') return c1 === c2;
        return c1.toLowerCase() === c2.toLowerCase();
    };

    function addToRecent(color: string) {
        if (!color || typeof color !== 'string') return;
        // Normalize color to lowercase
        const normalizedColor = color.toLowerCase();

        // Get current recent colors for this key
        let recent = [...(myRecentColors || [])];

        // Remove if already exists
        recent = recent.filter(c => typeof c === 'string' && c.toLowerCase() !== normalizedColor);

        // Add to front
        recent.unshift(normalizedColor);

        // Limit to max
        if (recent.length > maxRecent) {
            recent = recent.slice(0, maxRecent);
        }

        // Dispatch event to save
        dispatch('recentUpdate', { colorKey, colors: recent });
    }

    function openNativePicker() {
        showAwesomePicker = true;
    }

    function handleClickOutside(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (!target.closest('.color-picker-container') && !target.closest('.awesome-popup')) {
            addToRecent(value);
            showPopup = false;
            showAwesomePicker = false;
        }
    }

    onMount(() => {
        document.addEventListener('click', handleClickOutside);
        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    });
</script>

<div class="color-picker-container">
    <button
        class="color-preview"
        style="background-color: {displayValue};"
        on:click|stopPropagation={() => (showPopup = !showPopup)}
        title="选择颜色"
    >
        <span class="color-indicator"></span>
    </button>

    {#if showPopup}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="color-popup" on:click|stopPropagation>
            {#if myRecentColors.length > 0}
                <div class="color-section">
                    <div class="section-title">最近使用</div>
                    <div class="color-grid recent">
                        {#each myRecentColors as color}
                            <button
                                class="color-swatch"
                                class:selected={isSameColor(displayValue, color)}
                                style="background-color: {color};"
                                on:click={() => selectColor(color)}
                                title={color}
                            ></button>
                        {/each}
                    </div>
                </div>
            {/if}

            <div class="color-section">
                <div class="section-title">默认颜色</div>
                <div class="color-grid default">
                    {#each defaultColors as color}
                        <button
                            class="color-swatch"
                            class:selected={isSameColor(displayValue, color)}
                            style="background-color: {color};"
                            on:click={() => selectColor(color)}
                            title={color}
                        ></button>
                    {/each}
                </div>
            </div>

            <div class="color-section more">
                <button class="more-colors-btn" on:click={openNativePicker}>
                    <span class="rainbow-icon">🎨</span>
                    更多颜色...
                </button>
            </div>
        </div>
    {/if}

    <!-- native input removed, using svelte-awesome-color-picker -->
</div>

{#if showAwesomePicker}
    <div class="awesome-popup">
        <button
            class="close-btn"
            on:click={() => {
                addToRecent(value);
                showAwesomePicker = false;
            }}
            title="关闭"
        >
            ×
        </button>
        <ColorPicker
            isDialog={false}
            isAlpha={false}
            bind:hex={value}
            on:input={e => {
                dispatch('change', e.detail.hex);
            }}
        />
    </div>
{/if}

<style>
    .color-picker-container {
        position: relative;
        display: inline-block;
    }

    .color-preview {
        width: 32px;
        height: 24px;
        border: 1px solid #ccc;
        border-radius: 4px;
        cursor: pointer;
        padding: 2px;
        background-clip: content-box;
        transition: border-color 0.15s;
    }

    .color-preview:hover {
        border-color: #888;
    }

    .color-indicator {
        display: block;
        width: 100%;
        height: 100%;
    }

    .color-popup {
        position: absolute;
        top: 100%;
        left: 0;
        z-index: 1000;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        padding: 8px;
        min-width: 180px;
        margin-top: 4px;
    }

    .color-section {
        margin-bottom: 8px;
    }

    .color-section:last-child {
        margin-bottom: 0;
    }

    .section-title {
        font-size: 11px;
        color: #888;
        margin-bottom: 4px;
        font-weight: 500;
    }

    .color-grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 4px;
    }

    .color-grid.default {
        grid-template-columns: repeat(4, 1fr);
    }

    .color-swatch {
        width: 20px;
        height: 20px;
        border: 1px solid #ddd;
        border-radius: 3px;
        cursor: pointer;
        padding: 0;
        transition:
            transform 0.1s,
            box-shadow 0.1s;
    }

    .color-swatch:hover {
        transform: scale(1.15);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        z-index: 1;
    }

    .color-swatch.selected {
        border: 2px solid var(--b3-theme-primary, #1976d2);
        box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.3);
    }

    .more-colors-btn {
        width: 100%;
        padding: 6px 8px;
        border: 1px dashed #ccc;
        border-radius: 4px;
        background: #fafafa;
        cursor: pointer;
        font-size: 12px;
        color: #555;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        transition:
            background 0.15s,
            border-color 0.15s;
    }

    .more-colors-btn:hover {
        background: #f0f0f0;
        border-color: #999;
    }

    .rainbow-icon {
        font-size: 14px;
    }

    .awesome-popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10000;
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .close-btn {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 16px;
        color: #666;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.15s;
    }

    .close-btn:hover {
        background: #f0f0f0;
    }
</style>
