import chinese from '../../i18n/zh_CN.json';
import english from '../../i18n/en_US.json';

type TranslationDictionary = { [key: string]: string | TranslationDictionary };

let pluginInstance: any = null;

export function setPluginInstance(plugin: any) {
    pluginInstance = plugin;
}

/** SiYuan 的 plugin.i18n 是字典，语言标识来自全局配置。 */
export function getCurrentLanguage(): string {
    return globalThis.window?.siyuan?.config?.lang || 'zh_CN';
}

function getBundledTranslations(): TranslationDictionary {
    return getCurrentLanguage().toLowerCase().startsWith('zh') ? chinese : english;
}

function getTranslation(data: any, key: string): string | undefined {
    const value = key.split('.').reduce((current, part) => current?.[part], data);
    return typeof value === 'string' ? value : undefined;
}

/**
 * 优先使用内置的中英文资源，兼容 en/en_US 语言标识和旧的宿主翻译缓存。
 * 英文资源只维护 en_US.json。
 */
export function t(key: string, params?: Record<string, string>): string {
    const text = getTranslation(getBundledTranslations(), key)
        ?? getTranslation(pluginInstance?.i18n, key);

    if (text === undefined) {
        console.warn('未找到i18n键:', key);
        return key;
    }

    // 使用回调替换，保留文件名中的 $& 等特殊字符。
    return text.replace(/\$\{([^}]+)\}/g, (placeholder, name) => params?.[name] ?? placeholder);
}

export function hasTranslation(key: string): boolean {
    return getTranslation(getBundledTranslations(), key) !== undefined
        || getTranslation(pluginInstance?.i18n, key) !== undefined;
}

/**
 * 格式化带参数的翻译文本
 */
export function tf(key: string, ...args: any[]): string {
    const text = t(key);

    if (args.length === 0) {
        return text;
    }

    // 支持位置参数替换 {0}, {1}, {2} 等
    return text.replace(/\{(\d+)\}/g, (match, index) => {
        const argIndex = parseInt(index);
        return argIndex < args.length ? String(args[argIndex]) : match;
    });
}

/**
 * 多元化翻译（根据数量选择不同的翻译）
 */
export function tp(key: string, count: number, params?: { [key: string]: string }): string {
    let pluralKey = key;

    // 根据数量选择不同的键
    if (count === 0) {
        pluralKey = `${key}_zero`;
    } else if (count === 1) {
        pluralKey = `${key}_one`;
    } else {
        pluralKey = `${key}_other`;
    }

    // 如果复数形式不存在，回退到原始键
    if (!hasTranslation(pluralKey)) {
        pluralKey = key;
    }

    // 添加count参数
    const finalParams = { count: count.toString(), ...params };

    return t(pluralKey, finalParams);
}
