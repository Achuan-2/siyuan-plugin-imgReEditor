## 📝更新日志

见[CHANGELOG.md](https://cdn.jsdelivr.net/gh/Achuan-2/siyuan-plugin-imgReEditor@main/CHANGELOG.md)


## 开发背景

写笔记写博客，常常需要对图片进行标注、编辑，一直有一个痛点，那就是编辑的图片无法进行二次编辑。过去对图片进行裁剪、添加形状和文字，保存完图片之后就无法再修改原来的操作，只能在原有图片上再添加新内容，要么就直接替换新图片，这就给修改操作带来很大麻烦
	
于是，我开发了ImgReEditor 这个插件，终于实现了已编辑的图片还能二次编辑。

## 如何使用

图片右键菜单选择「ImgReEditor编辑」按钮


![](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20251219120448-2025-12-19.png)

## 功能介绍

在思源笔记中编辑图片，支持：

- 支持裁剪翻转图片，支持添加文字、添加矩形椭圆、添加箭头、添加数字序号、画笔等功能
- 保存png图片支持二次编辑插件添加的图片修改和标注内容

快捷键
- Esc：
  - 选中形状后取消选中；
  - 编辑文字后按Esc可变为选中状态进行移动，再按Esc则取消选中
- Ctrl+C/Ctrl+V：复制/粘贴
- Ctrl+Z/Ctrl+Y：撤回/重做

## 设置

- 编辑数据存储方式
  - 直接存储在当前图片里：- 图片永久存储编辑历史，不怕编辑历史丢失，图片发送给别人也能保留编辑数据，缺点是图片体积会变大
  - 存储在backup文件夹：减少图片体积，当不需要存储编辑数据再编辑图片时，可以把backup里的json文件直接删除



## 📄 许可证

MIT License


## 🔧 开发相关

```bash
pnpm install
pnpm run dev
```


## 🙏 致谢

- 基于 [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte/) 模板开发
- 参考 [oyjt/interactive-whiteboard](https://github.com/oyjt/interactive-whiteboard)的fabric的箭头绘制和形状控件实现

## ❤️用爱发电

如果喜欢我的插件，欢迎给GitHub仓库点star和微信赞赏，这会激励我继续完善此插件和开发新插件。

维护插件费时费力，个人时间和精力有限，开源只是分享，不等于我要浪费我的时间免费帮用户实现ta需要的功能，

我需要的功能我会慢慢改进（打赏可以催更），有些我觉得可以改进、但是现阶段不必要的功能需要打赏才改进（会标注打赏标签和需要打赏金额），而不需要的功能、实现很麻烦的功能会直接关闭issue不考虑实现

累积赞赏50元的朋友如果想加我微信，可以发邮件到<span data-type="a" data-href="mailto:achuan-2@outlook.com">achuan-2@outlook.com</span>来进行好友申请（赞赏达不到50元的，我不会回复邮件和加好友哦，因为不想当免费客服）


<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20241128221208-2024-11-28.png" />