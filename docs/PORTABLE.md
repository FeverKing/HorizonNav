# 启动与配置

1. 完整解压文件夹，保留 `dist`、`data` 和 `config.yaml`。
2. Windows 双击 `HorizonNav.exe`，或在终端运行；macOS/Linux 在终端执行 `./HorizonNav`。
3. 浏览器打开 http://127.0.0.1:5173 。手机访问后端电脑的局域网 IP:5173。
4. 游戏中开启 Data Out，发送到后端电脑的 IP，UDP 端口默认 9999。首次接收需放行系统防火墙中的 UDP 9999；手机访问需放行 HTTP 5173。
5. 关闭终端或 Ctrl+C 停止服务。

配置修改后重启。`http.host/port` 控制网页服务；`telemetry.host/port` 控制遥测接收；`frontend.path` 指定前端目录；`data.path` 指定外置路网目录。相对路径按配置文件位置解析，默认配置在二进制旁。自定义配置用 `HorizonNav -config 路径`。

`telemetry.forward.enabled: true` 开启原样 UDP 转发，`targets` 可配置多个 `IP:端口`。不要指向自身或组成转发环。查看 `http://127.0.0.1:5173/api/telemetry/status` 可检查转发计数。UDP 发送成功不保证接收端已收到。

默认真实 UDP 模式；无游戏数据时车辆不会自行行驶。想体验模拟导航，将 `telemetry.mode` 改成 `mock` 再重启。正式界面没有模拟调试栏。

路网为外置 `data/graph.json` 与 `data/roads.json`。更新同一份地图时需要同步对应前端地图资产（dist 下的道路、地标、底图），避免显示地图与算路数据不一致。无需重编译程序。

macOS 包未签名/公证，Windows 包未代码签名，操作系统可能要求确认运行。包内不需要安装 Go、Node.js 或 Python。合成遥测链路已测试，真实 FH6 数据布局/航向仍需要实机确认。
