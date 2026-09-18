# Forza Data Out 遥测接入说明

Go 后端已实现 UDP 接收、SSE 推送与多目标原样 UDP 转发。默认 `telemetry.mode: udp`；`mock` 为显式配置的演示模式，两者不会因断流自动切换。链路已用合成包测试，尚未实机联调。

## 已查阅的协议资料

- 官方 Data Out 入口：https://support.forzamotorsport.net/hc/en-us/articles/360005305033-Forza-Motorsport-Data-Out-feature （本次请求受站点防护，未据其页面推断具体字段）。
- 社区公开实现：https://github.com/richstokes/Forza-data-tools
- 固定参考版本：`73f8f7058479bf1c17fd9460e2cf379207d1cd2d`
- 字段表：https://github.com/richstokes/Forza-data-tools/blob/73f8f7058479bf1c17fd9460e2cf379207d1cd2d/FH4_packetformat.dat
- 社区讨论：https://forums.forza.net/t/data-out-telemetry-variables-and-structure/535984

该实现的 README 声明 Horizon 4/5/6 使用 `-z` 布局。它在 Motorsport 核心字段后增加 12 字节，常见总长 323 / 324 字节。Go 解析器位于 `telemetry.go`，UDP 监听地址与端口由 `config.yaml` 控制。未知长度只转发、不进入位置解析。

| 字段 | 小端字节偏移 | 类型 | 变换 |
| --- | ---: | --- | --- |
| IsRaceOn | 0 | i32 | 游戏是否处于驾驶状态 |
| TimestampMS | 4 | u32 | 单独保留，可能回绕 |
| CurrentEngineRpm | 16 | f32 | rpm |
| Yaw | 56 | f32 | 弧度转角度；需实机校准方向 |
| PositionX | 244 | f32 | 地图 X |
| PositionY | 248 | f32 | 海拔 Y |
| PositionZ | 252 | f32 | 地图 Z |
| Speed | 256 | f32 | × 3.6 → km/h |
| Gear | 319 | u8 | 原始挡位 |

## 前端统一数据契约

```ts
{
  source: 'mock' | 'udp',
  connected: boolean,
  timestamp: number,         // 接收时本机时间，毫秒
  position: [X, Z, Y],       // 米，禁止作为经纬度使用
  heading: number,           // 北向上顺时针角度
  speedKmh: number,
  rpm: number,
  gear: number,
  progress: number           // 沿所选路线的匹配进度，米
}
```

`src/telemetry.ts` 负责模拟遥测；`src/useRecovery.ts` 负责偏航状态转换。

## 数据链路与配置

1. 游戏 Data Out → `telemetry.host:port` UDP socket。
2. 每个包复制到各转发目标的独立有界队列，原样发送；无效/未知包也原样转发。每个目标最多缓存 256 包，队列满只丢该目标的新包，并记录计数。
3. 已知 323/324 字节布局解析为统一 Frame；拒绝 NaN、无限值、异常位置和速度。
4. SSE `/api/telemetry` 以最多 20 Hz 推送最新帧，不为慢网页堆积帧。浏览器自动重连。
5. 超过 `timeout_ms` 或 IsRaceOn=0 标记无有效驾驶信号，前端保留最后坐标并停用自动重算/到达判断。
6. 前端将真实位置匹配到所选路线线段以更新剩余距离。偏离路线超过 70 m 后检查附近道路，离道路超过 160 m 时进入返回道路状态，靠近道路到 120 m 内后重新算路。UDP 模式不执行模拟返回插值，车辆始终由游戏数据控制。

`heading_sign` 支持 1 / -1，`heading_offset` 单位为度。请在真实游戏确认方向和坐标，高架、回环和隧道仍需要航向/高度/连续轨迹匹配进一步完善。Gear 0 为倒挡、11 为 N，前端不会把真实 0 挡误显示为 N。

`GET /api/telemetry/status` 返回连接状态、接收数量、解析失败数量、每个目标的发送/丢弃/错误数；配置和原始遥测包不写入日志。监听失败、未知 YAML 字段、端口越界、自身转发目标在启动时明确报错。

返回道路虚线只表示最近路网的方向，不是可穿越地形的越野路线。数据包没有完整碰撞/水域可通行网格，不能宣称该直线能安全直接行驶。
