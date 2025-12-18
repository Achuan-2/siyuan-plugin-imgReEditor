Changelog
See CHANGELOG.md

Background
When writing notes and blog posts, I often need to annotate and edit images. A long-standing pain point was that edited images couldn't be re-edited. Previously, after cropping or adding shapes and text, once you saved the image you couldn't modify the previous edits — you could only add new content on top or replace the image entirely. This made revisions cumbersome.

Therefore, I developed the ImgReEditor plugin, which finally enables re-editing of previously edited images.

Features
Edit images inside Siyuan Note with support for:

Cropping and flipping images; adding text, rectangles/ellipses, arrows, numbered markers, freehand drawing, and more.
Saving PNG images with embedded editing data so plugin-added modifications and annotations can be re-edited later.


Settings
Storage method for edit data
Store directly inside the current image: The image permanently retains its edit history, so you won't lose editing data and the edit information remains when sharing the image with others. The downside is increased image file size.
Store in a backup folder: Reduces image size. If you no longer need the edit data, you can delete the corresponding JSON files in the backup folder.
License
MIT License

Development
Thanks
Built on the plugin-sample-vite-svelte template
Support
If you like this plugin, please star the GitHub repository and consider supporting via WeChat donations — this encourages me to continue improving this plugin and develop new ones.

Maintaining a plugin takes time and effort. Open-sourcing is sharing, not a commitment to provide free implementation for every user request.

I will gradually improve features I need myself (donations can speed things up). Some improvements that are reasonable but not essential right now may be implemented only after receiving donations (these will be labeled as paid features with required amounts). Features I don't need or that are very difficult to implement may be closed without consideration.

Friends who donate a cumulative amount of 50 CNY and want to add me on WeChat can email achuan-2@outlook.com to request contact (I will not respond to emails or add contacts from people who haven't reached 50 CNY, because I don't want to act as free customer support).


<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20241128221208-2024-11-28.png" />