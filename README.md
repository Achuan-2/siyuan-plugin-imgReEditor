## 📝 Changelog

See [CHANGELOG.md](https://cdn.jsdelivr.net/gh/Achuan-2/siyuan-plugin-imgReEditor@main/CHANGELOG.md)

## Development Background

When taking notes or writing blogs, there is often a need to annotate and edit images. A persistent pain point has been the inability to re-edit images after the initial edit. In the past, after cropping an image, adding shapes and text, and saving it, the original operations could no longer be modified. One could only add new content on top of the existing image or simply replace it with a new one, which made modifications very troublesome.

Therefore, I developed the ImgReEditor plugin, finally achieving the ability to re-edit already edited images.

## Features

Edit images in SiYuan Note, supporting:

-   Crop and flip images, add text, add rectangles/ellipses, add arrows, add numbered sequences, brush tools, and other functions.
-   Saved PNG images support re-editing of modifications and annotations added by the plugin.

![](preview.png)

## Settings

-   **Edit Data Storage Method**
    -   **Store directly in the current image:** Edit history is permanently stored within the image,不怕编辑历史丢失, and edit data is retained even when the image is sent to others. The downside is that the image file size increases.
    -   **Store in the backup folder:** Reduces image file size. When edit data storage is no longer needed for re-editing, the JSON files in the backup folder can simply be deleted.

## 📄 License

MIT License

## 🔧 Development Related

```bash
pnpm install
pnpm run dev
```

## 🙏 Acknowledgments

-   Developed based on the [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte/) template.

## ❤️ Powered by Love

If you like my plugin, feel free to give a star on the GitHub repository or send a WeChat appreciation. This will motivate me to continue improving this plugin and developing new ones.

Maintaining plugins is time-consuming and labor-intensive. Personal time and energy are limited. Open source is about sharing, not about me wasting my time implementing features users need for free.

I will gradually improve features I find necessary (appreciations can nudge me along). Some features I think could be improved but aren't currently essential will require appreciation to be prioritized (marked with an appreciation tag and required amount). Features I don't need or that are very troublesome to implement will have their issues closed and won't be considered.

Friends whose cumulative appreciation reaches 50 RMB and wish to add me on WeChat can send an email to <span data-type="a" data-href="mailto:achuan-2@outlook.com">achuan-2@outlook.com</span> to request a friend application (I will not reply to emails or add friends if the appreciation is less than 50 RMB, as I don't want to be a free customer service).

<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20241128221208-2024-11-28.png" />