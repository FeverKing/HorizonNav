# HorizonNav

[English](README.md) | [简体中文](README.zh-CN.md)

Forza Horizon 导航伴侣：交互式地图、路线规划、转向指引、自动重新算路，以及支持多目标转发的实时 UDP 遥测。

## 界面截图

<p>
  <img src="docs/screenshots/route.png" alt="路线规划" width="260" />
  <img src="docs/screenshots/navigation.png" alt="使用模拟遥测的导航界面" width="260" />
</p>

截图使用模拟遥测。

## 快速开始

1. 从 [Releases](https://github.com/FeverKing/HorizonNav/releases) 下载对应平台的运行包。
2. 完整解压文件夹，按需修改 `config.yaml`。
3. Windows 运行 `HorizonNav.exe`，macOS/Linux 运行 `./HorizonNav`。
4. 打开 **http://localhost:5173**。手机使用电脑的局域网 IP 和相同端口访问。
5. 在游戏中开启 **Data Out**，将目标地址设置为电脑的 IP，UDP 端口设置为 **9999**。

运行发布包无需安装 Node.js、Go、Python 或数据库。

```text
HorizonNav.exe       # macOS/Linux 上为 HorizonNav
config.yaml
dist/                # 前端与地图资源
data/                # 外置算路图数据
```

## 配置

修改 `config.yaml` 后重启：

- `http.host` / `http.port`：网页服务地址（默认 `0.0.0.0:5173`）。
- `frontend.path`：前端目录（默认 `./dist`）。
- `data.path`：外置算路数据目录（默认 `./data`）。
- `telemetry.host` / `telemetry.port`：UDP 接收地址（默认 `0.0.0.0:9999`）。
- `telemetry.mode`：`udp` 使用实时数据，`mock` 使用模拟驾驶。
- `telemetry.forward.enabled`：开启原始 UDP 转发；在 `targets` 中列出目标地址。

```yaml
forward:
  enabled: true
  targets:
    - "127.0.0.1:10000"
    - "192.168.1.20:10001"
```

将这段配置放在 `telemetry` 下。不要转发回接收端，也不要形成转发环路。

默认读取可执行文件旁的配置。相对路径以配置文件所在目录为基准。使用 `HorizonNav -config /path/to/config.yaml` 可指定其他配置文件。

## 说明

请在可信的局域网中使用；网页服务没有身份验证。从其他设备连接时，需要在防火墙中放行配置的 TCP/UDP 端口。运行包未进行代码签名。

实时接收、转发和重连已通过合成遥测测试；**真实 FH6 游戏实机验证仍待完成**。解析器接受社区 Horizon 的 323/324 字节格式。离路指引表示返回道路的方向，不代表没有障碍物的可通行路径。

更多信息见[开发文档](docs/DEVELOPMENT.md)、[遥测文档](docs/TELEMETRY.md)和[地图数据](docs/SOURCE-DATA.md)。
