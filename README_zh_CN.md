插件 Github 地址：https://github.com/Achuan-2/siyuan-plugin-image-editor

![](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20251222152540-2025-12-22.png)



## 📝更新日志

见[CHANGELOG.md](https://cdn.jsdelivr.net/gh/Achuan-2/siyuan-plugin-imgReEditor@main/CHANGELOG.md)

## 开发背景

写笔记写博客，常常需要对图片进行标注、编辑，一直有一个痛点，那就是编辑的图片无法进行二次编辑。过去对图片进行裁剪、添加形状和文字，保存完图片之后就无法再修改原来的操作，只能在原有图片上再添加新内容，要么就直接替换新图片，这就给修改操作带来很大麻烦

于是，我开发了 ImgReEditor 这个插件，终于实现了已编辑的图片还能二次编辑。

一开始是调用 tui.image-editor 这个开源编辑器，但是后来发现不方便修改，想要让裁剪能二次修改、添加序号、马赛克工具很麻烦。于是就让ai使用 fabric.js 从无到有自己写了一个图片编辑器

## 如何使用

1. 编辑图片：图片右键菜单选择「ImgReEditor 编辑」按钮

<img alt="" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/network-asset-20251219120448-2025-12-19-20251219163021-8edvw9l.png" />

2. 画布模式：斜杆菜单输入`/画布`可以开启画布模式，在画布添加多个图片

  <img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20251219182552-59o8aso.png" />

  ![](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20251221013822-2025-12-21.png)

3. 支持截图: `Ctrl+~`截图并标注，支持保存截图历史，支持截图后贴图

## 功能介绍

在思源笔记中编辑图片，支持：

- 图片编辑功能

  - 支持裁剪图片
  - 支持水平/垂直翻转、旋转图片
  - 添加文字
  - 添加矩形椭圆
  - 添加箭头
  - 添加数字序号
  - 添加画笔
  - 添加马赛克
  - 添加图片边框
  - 插入多张图片
- 保存png图片支持二次编辑插件添加的图片修改和标注内容
- 画布模式：支持在一个画布里添加多个图片进行编辑和排版

<img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20251219163257-4crcvcx.png" />


插件支持快速添加图片边框，把图改为精致的博客风格，如果你想要给笔记里的截图添加圆角+边框效果，过去要使用专门的软件才能做到

![](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20251221002000-2025-12-21.png)

现在只需要在思源笔记里点击一下就可以创建这样的图了！

![](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/图片背景色-2025-12-21.gif)

## 使用细节

**常用快捷键**

- Esc：取消选中

  - 选中形状后取消选中；
  - 编辑文字后按 Esc 可变为选中状态进行移动，再按 Esc 则取消选中
- Ctrl+C/Ctrl+V：复制/粘贴
- Ctrl+Z/Ctrl+Y：撤回/重做

**矩形、箭头、文字等工具如何快速进入选择对象状态**

- 这些工具直接点击的话是新增对象状态，虽然也支持点击选择当前已有的对象，但是没点到的话就容易误增加对象，一个技巧是，按住Ctrl即可快速进入选择状态，只能选择对象，不会再误添加对象，并且支持多选对象进行批量设置样式和对齐等操作
- 文字工具参考了Adobe illustrator交互，按Ctrl可以拖动，不拖动还可以继续编辑，这样不影响Ctrl+C/Ctrl+V复制粘贴文字

**选中形状后，可以对形状进行拉伸和旋转，旋转技巧**

- 旋转按钮：选中形状的选框正下方有旋转按钮，四个角鼠标悬浮也会显示旋转按钮，可以进行调整形状角度
- 按住shift进行拖动，会吸附到 45° 倍数

![](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20251220115034-2025-12-20.png)

## 设置

- 编辑数据存储方式

  - Embed 存储模式：直接存储在当前图片里，图片永久存储编辑历史，不怕编辑历史丢失，图片发送给别人也能保留编辑数据，缺点是图片体积会变大
  - Backup 存储模式：存储在backup文件夹，减少图片体积，当不需要存储编辑数据再编辑图片时，可以把backup里的json文件直接删除

## 注意事项

- Embed 存储模式：

  - 编辑数据存储在图片里，正常使用不会丢失，但是需要注意使用图片压缩等外部软件处理图片后可能会导致数据丢失，无法二次编辑
- Backup 模式：

  - 删除backup文件夹里的json文件，将无法二次编辑backup模式下编辑保存的图片
  - 保存的图片经过外部软件压缩等处理之后，也可能会丢失与backup里的json的链接关系，无法二次编辑

## 博客

- 文章
  - [思源笔记插件 ImgReEditor：图片编辑保存还可再编辑，让思源笔记成为你的图文笔记神器](https://zhuanlan.zhihu.com/p/1985459256305152111)
  - [思源笔记插件 ImgReEditor：一键添加图片背景色、边框、圆角，生成精美博客图片](https://zhuanlan.zhihu.com/p/1985856269366611979)
  - [在思源笔记里也能直接制作文章封面啦](https://zhuanlan.zhihu.com/p/1986456451837862115)
- 视频
  - [思源笔记插件 ImgReEditor：图片编辑保存还可再编辑，让思源笔记成为你的图文笔记神器](https://www.bilibili.com/video/BV11wBFBvEn8/?vd_source=b4a1fcb6dce305e26d8d16d9cbb71304#reply285851298256)

## 📄 许可证

MIT License


## 🔧 如何打包插件

```bash
pnpm install
pnpm run dev
```

## 🙏 致谢

- 基于 [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte/) 模板开发
- 图片编辑器基于fabric v6开发
- 参考 [oyjt/interactive-whiteboard](https://github.com/oyjt/interactive-whiteboard)的fabric的箭头绘制和形状控件实现

## ❤️用爱发电

如果喜欢我的插件，欢迎给GitHub仓库点star和微信赞赏，这会激励我继续完善此插件和开发新插件。

维护插件费时费力，个人时间和精力有限，开源只是分享，不等于我要浪费我的时间免费帮用户实现ta需要的功能，

我需要的功能我会慢慢改进（打赏可以催更），有些我觉得可以改进、但是现阶段不必要的功能需要打赏才改进（会标注打赏标签和需要打赏金额），而不需要的功能、实现很麻烦的功能会直接关闭issue不考虑实现

累积赞赏50元的朋友如果想加我微信，可以发邮件到<span data-type="a" data-href="mailto:achuan-2@outlook.com">achuan-2@outlook.com</span>来进行好友申请（赞赏达不到50元的，我不会回复邮件和加好友哦，因为不想当免费客服）


<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20241128221208-2024-11-28.png" />
