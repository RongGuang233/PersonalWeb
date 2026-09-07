# RongGuang233 个人网站

Python 3.10+ 标准库、SQLite、原生 HTML/CSS/JS。浏览器 Markdown 使用 MIT 许可的 Marked、KaTeX 和 marked-katex-extension，自托管脚本、样式与公式字体；服务器无需 Node 或第三方 Python 依赖。package.json 声明浏览器运行依赖，package-lock.json 记录当前解析版本。维护该资源时使用 Node 20+，执行 npm ci、npm run vendor:markdown；浏览器不请求外部 CDN。

首页采用个人资料侧栏与内容区的双栏布局，手机上自动调整为单栏。使用系统无衬线字体和原创封面，可切换浅色、深色外观，提供博客、笔记、友链、作品、收藏、搜索和归档。博客承载完整文章，笔记支持短记录与学习资料；友链与资源收藏分开。作品保留七种分类、进度、可选的 0–10 分评分和短评，以可筛选封面墙展示；首页显示最多三篇精选/置顶文章（未选择时显示最新一篇）、紧凑笔记和最多四部公开作品。没有公开作品时不显示作品区，不填充示例记录。无封面文章使用紧凑文字卡，有封面时保留图片；笔记列表展示摘要。手机阅读页隐藏完整个人侧栏，将简短作者信息放在正文之后；宽公式只在公式区域内横向滚动。

## 内容与头像

点击“私人空间”并登录后，入口显示为“内容管理”，可管理内容与个人资料。登录后公开文章、笔记、作品详情提供“编辑此篇”，侧栏提供“编辑资料”；快捷编辑会读取最新内容，发布后原阅读页即时更新。新增博客、笔记、作品、友链和收藏默认公开，勾选“仅自己可见”后保存为私密。自动保存的草稿仍仅自己可见，点击发布按钮后才公开。已有记录与恢复的草稿保留原公开设置；编辑内容时，省略公开状态会保留原状态。

博客、笔记使用宽版编辑窗口，正文优先显示，支持编辑/预览切换和字符计数；封面、摘要及公开范围在发布设置中，手机上默认折叠。保存按钮固定在窗口底部，并显示保存后的可见范围。正文最多 50,000 个 Unicode 字符（包括 emoji）；超限时会提示修改。后台文章列表显示摘要与编辑入口，公开页保留全文。

博客和笔记停止输入约 0.7 秒后自动保存到服务器私密草稿，可无标题保存；关闭编辑器会先完成保存。私人列表的“继续草稿”支持恢复、丢弃，跨浏览器登录后也可继续。编辑已公开内容时，正文、封面、精选和公开设置均先进入草稿，只有点击“发布内容/更新公开内容/保存为私密内容”才提交到正式记录。丢弃草稿不改变原正式记录。网络或会话失败会保留当前输入并提示重试，不关闭编辑器；刷新/关闭标签页对尚未保存输入使用浏览器离开提醒。其他内容、资料和待上传图片仍使用明确保存及离开提醒。

在“私人空间 → 个人资料”中编辑名称、简介；点击“选择图片”，查看圆形预览后点击“保存头像”，也可取消更换或恢复默认。浏览器支持 10 MB 以内的 PNG、JPEG、WebP 图片，可拖动、缩放、重置裁剪，确认后以 512 × 512 像素 PNG 上传；服务器接收最多 1 MiB 的 PNG。头像保存在 SQLite 中，重启后保留。名称、简介和头像会展示在公开首页；恢复默认后显示字母占位头像。

博客和作品可在新增/编辑时选择封面；源图支持 PNG、JPEG、WebP，最大 8 MB，浏览器按最长边 1200 像素压缩为 JPEG。服务器接收最多 2 MiB 的封面，存于 SQLite 的 `record_covers` 表；仅公开记录的封面允许匿名读取。替换不保留旧图，删除记录同步删除封面。

作品编辑器在输入名称停顿后按所选分类搜索候选封面，也可点击“搜索封面”手动重试。候选展示名称、版本信息与来源链接；点选仅替换待保存的封面，不改动名称、评分、进度或公开状态，点击“保存”后才写入原封面表。封面搜索与图片读取仅登录者可用，来源未收录或不可用时仍可手动上传。搜索不会批量补齐已有作品。影视、动漫使用豆瓣影视公开检索，漫画、小说、出版书籍使用豆瓣图书公开检索，游戏使用 Steam 商店公开检索，无需 API 密钥。图书和动漫候选可能混有同名版本，需要手动核对；游戏仅覆盖 Steam 收录范围。公开网页检索接口可能变更或限流，无法获取时保留手动上传。图片由服务器按需读取，选定后由浏览器压缩为 JPEG，保存后使用本站图片，不依赖外部图片链接展示。

正文支持 Markdown 表格、围栏代码、引用、任务列表、链接与数学公式。行内公式使用 `$…$`，块级公式使用单独成行的 `$$` 包围；预览和公开页使用同一解析器，代码块与转义的美元符号保持原样。首页、列表和搜索摘要省略公式源码，纯公式内容显示“数学公式笔记”。数学排版由浏览器完成，服务器不增加计算依赖。点击“插入图片”后自动压缩并插入 Markdown；本地图片随公开状态控制访问，未发布草稿图片只供所有者读取。原始 HTML 显示为文字；外部图片不直接加载，可下载后自行上传。正文中的远程链接仍可使用。

博客编辑的发布设置可以选择“首页精选”和“置顶文章”；仅已公开内容会展示。友链支持上传可裁剪头像、填写显示顺序（数字越小越前），未设置头像时保留文字占位。个人资料还可更换侧栏背景，使用可调整的 3:1 裁剪并支持恢复默认。

内容管理侧栏提供“导出全部内容”，文章/笔记列表提供单篇导出。下载为 ZIP，包含 UTF-8 Markdown 和 images/ 下的本地图片，相对链接可离线使用；全部导出还包括五类内容、私密草稿、头像和背景，只有登录后可以下载，不含密码或会话。

服务导航和服务健康检查已移除；旧数据库中的服务记录仍保留，不再提供对应功能。会话默认 12 小时，到期需重新登录；退出或重设唯一账号会撤销相应会话。

## 本机运行

```sh
python3 server.py account
python3 server.py --port 3080
```

打开 http://127.0.0.1:3080 。账号初始化通过终端输入，密码不会回显；不要把密码放进聊天、命令参数或环境变量。再次执行 `account` 会替换唯一账号并注销已有会话。`SITE_DB` 可指定数据库路径，默认 `data/site.sqlite3`。

```sh
python3 -m unittest discover -s tests -v
python3 scripts/build.py
```

产物为 `dist/personal-website.tar.gz`，只包含应用、静态文件、部署配置和说明，不含账号、数据库或测试数据。前端无需编译；构建执行 Python 语法验证并打包部署文件。

## 部署配置

`deploy/personal-website.service` 使用专用用户 `personal-site` 运行应用，程序目录为 `/opt/projects/personal-website`，数据库独立放在 `/var/lib/personal-website`。确保数据库目录归该用户且仅其可读写；更新应用时保留数据库。

在 `/etc/personal-website.env` 中按实际访问地址设置 `SITE_ORIGIN`。HTTPS 就绪后，在独立的站点 server 中采用 `deploy/openresty.conf` 的 location 配置，勿覆盖其他服务。现有 OpenResty 在使用 host 网络的容器中运行，应用文件未挂载到该容器；模板将本站页面、静态文件和 API 一并代理到回环服务。头像上传请求允许 1536 KiB，文章/作品封面及统一媒体上传允许 3 MiB；博客、笔记和草稿写入请求允许 1 MiB，以容纳完整的 50,000 字符正文及 JSON 转义。其余后端 API 请求仍限制为 64 KiB。应用只监听本机 3080 端口，不开放该端口到公网。OpenResty 配置测试通过后再 reload。

如需初始化或重设服务器上的唯一账号，在服务器终端执行：

```sh
sudo -u personal-site env SITE_DB=/var/lib/personal-website/site.sqlite3 /usr/bin/python3 /opt/projects/personal-website/server.py account
```

域名与 HTTPS 未就绪时，可使用 SSH 隧道访问，`SITE_ORIGIN` 设为对应的本机访问地址。部署后另行验证登录、公开与私密内容边界、头像上传，以及服务重启后的持久化。

## 更新与回滚

更新前保留上一份发布包和本站 OpenResty 配置，备份 SQLite 数据库。初始化会增量新增个人资料、封面、草稿和媒体表，可重复执行；不会重写已有内容、账号或个人资料，也不会删除旧服务记录。更新只替换应用和本站配置。需要回滚时恢复上一发布包与配置，保留数据库，执行 OpenResty 配置测试后再重启本站服务与 reload。

## 每日备份与恢复

每天上海时间 04:30 通过 systemd timer 执行 SQLite online backup，错过时间会在下次启动补做；保留最近 7 个日期的备份，同日重跑替换当天备份。备份存于 /var/backups/personal-website，由 personal-site 所有且仅其可读写。完整备份包括账号、全部内容、草稿及图片；在完成并通过 integrity_check 后原子发布，成功后才轮换。此为服务器本地备份；全部内容导出可另外保存到自己的设备。

```sh
install -d -m 0700 -o personal-site -g personal-site /var/backups/personal-website
install -m 0644 deploy/personal-website-backup.service /etc/systemd/system/
install -m 0644 deploy/personal-website-backup.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/personal-website-backup.service /etc/systemd/system/personal-website-backup.timer
systemctl daemon-reload
systemctl start personal-website-backup.service
systemctl enable --now personal-website-backup.timer
systemctl list-timers personal-website-backup.timer
```

需要恢复时，先将选定备份复制到独立临时目录，用 Python sqlite3 执行 integrity_check 并查看内容/图片数量确认选对备份；保留当前库后短暂停止本站服务，再将已核验的备份替换为 SITE_DB 指定文件，设置 personal-site:personal-site、0600，启动服务并核验。不可在运行中的数据库上直接覆盖文件。当前默认数据库为独立文件，若自行启用了 WAL，还须在服务停止后妥善处理旧 -wal/-shm 旁文件，避免带入不属于恢复库的日志。

## 验证入口

- `python3 -m unittest discover -s tests -v`：临时数据库中的 HTTP 功能、旧库增量初始化、正文/媒体访问边界、草稿提交、导出与备份恢复。
- `npm test`：公式、摘要、表格、代码、HTML转义、图片/链接规则，以及草稿恢复与提交回归。
- `python3 tests/browser_fixture.py`：仅用于浏览器验收的临时账号与数据库，退出进程即清理，不能用作部署。
- `python3 tests/deployment_acceptance.py /opt/projects/personal-website`：使用实际安装代码和当前 Python，在独立临时库中验收并重启验证持久化，不修改正式内容。
- 部署和真实浏览器验收结果记录在 artifacts，实体手机体验尚未验证。
