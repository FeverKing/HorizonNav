# Forza Data Out 遥测接入说明

当前应用仅使用模拟遥测。模拟车位沿真实路网插值，速度、暂停、倍率与偏航场景均可操作；不会把模拟连接显示成真实游戏连接。

## 已查阅的协议资料

- 官方 Data Out 入口：https://support.forzamotorsport.net/hc/en-us/articles/360005305033-Forza-Motorsport-Data-Out-feature （本次请求受站点防护，未据其页面推断具体字段）。
- 社区公开实现：https://github.com/richstokes/Forza-data-tools
- 固定参考版本：`73f8f7058479bf1c17fd9460e2cf379207d1cd2d`
- 字段表：https://github.com/richstokes/Forza-data-tools/blob/73f8f7058479bf1c17fd9460e2cf379207d1cd2d/FH4_packetformat.dat
- 社区讨论：https://forums.forza.net/t/data-out-telemetry-variables-and-structure/535984

该实现的 README 声明 Horizon 4/5/6 使用 `-z` 布局。它在 Motorsport 核心字段后增加 12 字节，常见总长 323 / 324 字节。项目附带了独立的预留解析器 `server/telemetry-contract.mjs`，目前没有开启 UDP 监听器，也没有实机联调。

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

## 接入真实游戏的下一步

1. 后端使用 `node:dgram` 监听指定 UDP 端口（通常 9999），游戏内开启 Data Out 并填写运行本服务设备的局域网 IP。
2. 先抓取实际 FH6 数据包，确认长度、字段偏移、X/Z 正负与 Yaw 基准。预留解析器拒绝未知长度，不会猜测字段。当前 headingSign / headingOffset 参数仅用于后续校准。
3. 后端将验证后的帧通过 WebSocket / SSE 输出给浏览器（浏览器不能直接接收 UDP）。替换 mock provider，保留统一契约。
4. 接收超过 2 秒无更新时进入断流状态，暂停自动算路，不能继续冒充实时连接。
5. 实机地图匹配应同时使用位置、航向、高度与轨迹连续性；高架/隧道不可只按 X/Z 最近节点匹配。用实际速度更新时间估计，停止使用模拟挡位。
6. 添加多帧偏航去抖、回路恢复迟滞与请求取消；此版的模拟偏航在距路线 70 m、距道路 160 m 时分流，在重新算路后保留 1.5 秒缓冲。

返回道路虚线只表示最近路网的方向，不是可穿越地形的越野路线。数据包没有完整碰撞/水域可通行网格，不能宣称该直线能安全直接行驶。
