<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';

    export let value: string = '#ff0000';
    export let colorKey: string = 'default'; // unique key for this color picker to store recent colors
    export let recentColors: Record<string, string[]> = {}; // passed from parent, keyed by colorKey
    export let maxRecent: number = 8;

    const dispatch = createEventDispatcher();

    let showPopup = false;
    let inputRef: HTMLInputElement | null = null;

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

    function selectColor(color: string) {
        value = color;
        dispatch('change', color);
        addToRecent(color);
        showPopup = false;
    }

    function addToRecent(color: string) {
        // Normalize color to lowercase
        const normalizedColor = color.toLowerCase();

        // Get current recent colors for this key
        let recent = [...(myRecentColors || [])];

        // Remove if already exists
        recent = recent.filter(c => c.toLowerCase() !== normalizedColor);

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
        if (inputRef) {
            inputRef.click();
        }
    }

    function handleNativeInput(e: Event) {
        const newColor = (e.target as HTMLInputElement).value;
        value = newColor;
        dispatch('change', newColor);
    }

    function handleNativeChange(e: Event) {
        const newColor = (e.target as HTMLInputElement).value;
        value = newColor;
        dispatch('change', newColor);
        showPopup = false;
        addToRecent(newColor);
    }

    function handleClickOutside(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (!target.closest('.color-picker-container')) {
            showPopup = false;
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
        style="background-color: {value};"
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
                                class:selected={value.toLowerCase() === color.toLowerCase()}
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
                            class:selected={value.toLowerCase() === color.toLowerCase()}
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

    <input
        bind:this={inputRef}
        type="color"
        {value}
        on:input={handleNativeInput}
        on:change={handleNativeChange}
        class="hidden-input"
    />
</div>

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

    .hidden-input {
        position: absolute;
        width: 0;
        height: 0;
        opacity: 0;
        pointer-events: none;
    }
</style>
