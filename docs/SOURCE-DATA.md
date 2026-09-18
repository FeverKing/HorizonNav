# FH6 Brio 数据包说明

游戏 **Forza Horizon 6** 地图 **Brio** 的路网 / 地名 / 底图 / 高度，全部是游戏本体解出来的，不是描的。

坐标系 **不是 WGS84**，单位是米。不要把 X/Z 当经纬度。

| | |
|---|---|
| 游戏版本 | `track=440771_7583212` `shader=code.331664_asset.438107` |
| 节点 | **38,473** |
| 道路 | **1,531** 条折线 |
| 可路由边 | **39,433** / **769.773 km** / 1 个连通分量 |
| 交叉口 | 1,849 |
| 单向道路 / 单向边 | 257 / 7,651 |
| 隧道 | 46 |
| 地名 / 地区 | 74 / 10 |

---

## 1. 目录

```
data/
├── README.md                 本说明
├── meta.json                 范围、计数、文件清单
├── transforms.json           世界 ↔ 像素
├── graph.npz                 路由图（推荐用来寻路）
├── height.npy                1024×1024 float32 高度（米）
├── landmarks.csv             地名表（Excel 可直接开）
├── geojson/
│   ├── roads.geojson         道路折线 [X, Z, Y]
│   ├── nodes.geojson         全部节点 [X, Z, Y]
│   ├── landmarks.geojson     74 个地名
│   └── regions.geojson       10 个地区多边形 [X, Z]
└── maps/
    ├── amap_base.jpg         4096 高德底图（无道路，给 3D 地形贴）
    ├── amap_roads.png        8192 高德全图（含道路 + 标注）
    ├── amap_roads_4096.png   同上 4096
    ├── amap_roads_preview.png 1800 预览
    ├── sat.jpg               4096 官方卫星底图
    └── height.png            1024 打包 u16 高度图（给 GPU）
```

完整 8192 卫星底图在仓库 `out/basemap_summer.png`（约 86 MB），这里放 4096 JPEG 够用。

---

## 2. 坐标系

右手系，单位 **米**：

* **X** 东
* **Y** 上
* **Z** 北

GeoJSON 的 `coordinates` 写成 **`[X, Z, Y]`**（东、北、上）。
二维工具忽略第三项，得到的就是北朝上的平面图。

底图覆盖范围（与 8192 官方瓦片对齐）：

```
X ∈ [-12541.169, 9481.274]
Z ∈ [-11275.139, 10741.928]
Y 节点  ∈ [93.375, 1150.283]
Y 高度图 ∈ [85.66, 1156.979]
海平面约 103.086 m
```

世界 → 8192 底图像素（北朝上，v 向下）：

```
u =  0.37198417 * X + 4665.1163
v = -0.37207499 * Z + 3996.8027
```

约 **2.6883 m / px**。反变换和 Map Reveal 海报的系数见 `transforms.json`。

> `MapIncludeDebugBackgroundTileLayout.xml` 里的 1862 m/瓦片是过期数据，不要用。

高度图 / 贴图采样（行 0 = 北，列 0 = 西）：

```
u = (X - Xmin) / (Xmax - Xmin)
v = (Zmax - Z) / (Zmax - Zmin)     # 北在上
row = v * (size - 1)
col = u * (size - 1)
```

`maps/height.png`：R = u16 高字节，G = 低字节。

```
y = y_min + (R * 256 + G) / 65535 * (y_max - y_min)
```

`y_min` / `y_max` 在 `meta.json` → `bbox.y_height`。`height.npy` 是同一张图的 float32，直接用这个更省事。

---

## 3. 路网 `geojson/roads.geojson`

每条 Feature = 游戏 `RoadTable` 里的一条路，顶点是 nav 节点，**不是**几何拟合。

`geometry.coordinates`：`[X, Z, Y]` 折线，相邻点中位间距约 24 m。

常用属性：

| 字段 | 含义 |
|---|---|
| `id` | 道路下标 0…1531（与 `graph.npz` 的 `edge_road` 对应） |
| `n` | 顶点数 |
| `length_m` | 折线长度（米） |
| `display_name` | 游戏内部名（`road_XXXX` / `freeway`） |
| `road_type` | 见下表 |
| `road_level` | `lower` / `low` / `level` / `high` / `higher`（高度层，不是宽度） |
| `oneway_forward` | `"true"` = 只能沿折线方向走 |
| `is_tunnel` | `"true"` |
| `is_layered` | `"true"` 分层/高架相关 |
| `deadend` / `give_way` / `no_right_turn` / `uturn` / `knot` / `stunt` | 布尔字符串 |

缺省字段表示这条路没有这项属性。

`road_type` 数量：

```
{"dirt": 112, "a": 366, "b": 346, "hidden": 456, "shortcut": 18, "trail": 193, "freeway": 35, "evolving_world": 5}
```

| 类型 | 建议画法 |
|---|---|
| freeway | 橙边 + 乳白，最宽 |
| a / b | 白路 + 灰套边 |
| hidden | 细白支路 |
| dirt | 土黄虚线 |
| trail | 细点线 |
| shortcut | 绿虚线 |
| evolving_world | 紫 |

立体结构：两条路 XZ 很近、Y 差 ≥ 5 m 就是高架，上层盖住下层。
同高度、同类型、近似平行的是双向双幅（两条单向），平面图上通常合成一条画。

---

## 4. 路由图 `graph.npz`

从道路折线的连续节点对建成，**39,433** 条边、**769.8 km**、1 个连通分量。
只补了 2 条 ≤150 m 的桥接边（孤儿节点 52503 / 52504）。

| 字段 | shape | 含义 |
|---|---|---|
| `positions` | (38473, 3) f64 | 世界 X/Y/Z（米） |
| `node_ids` | (38473,) i64 | 游戏节点 ID |
| `node_slot` | (38473,) i64 | nav 槽位号 |
| `node_flags` | (38473,) u32 | 节点标志 |
| `quat` | (38473, 4) f32 | 朝向四元数 |
| `yaw` | (38473,) f32 | 航向（弧度） |
| `edges` | (39433, 2) i32 | 折线方向 `(from, to)` |
| `edge_lengths` | (39433,) f32 | 边长（米） |
| `edge_road` | (39433,) i32 | 所属道路 `id`，`-1` = 桥接 |
| `edge_oneway` | (39433,) u8 | 1 = 只允许折线方向 |
| `indptr, indices, weights` | CSR | **已按单行道裁剪**的有向邻接表 |

```python
import numpy as np
from scipy.spatial import cKDTree

z = np.load("data/graph.npz")
pos = z["positions"]                          # (N,3) X Y Z
tree = cKDTree(pos[:, [0, 2]])                # 水平面
i = int(tree.query([-1800, -4600])[1])        # 东京附近

indptr, indices, w = z["indptr"], z["indices"], z["weights"]
def neighbors(u):
    a, b = int(indptr[u]), int(indptr[u + 1])
    return list(zip(indices[a:b], w[a:b]))    # (v, metres)
```

---

## 5. 地名

`geojson/landmarks.geojson` / `landmarks.csv`：74 个触发体中心，中英名。
`geojson/regions.geojson`：10 个地区多边形。

| key | 中文 | 英文 |
|---|---|---|
| canyon | 大谷 | Ohtani |
| city | 东京市 | Tokyo |
| east_coast | 伊东 | Ito |
| festival | 嘉年华场地 | Festival Site |
| highlands | 高城 | Takashiro |
| legend_island | 传奇岛 | Legend Island |
| north_plains | 北部 | Hokubu |
| snowy_mountains | 霜山 | Shimanoyama |
| south_coast | 南岸 | Nangan |
| south_plains | 南野 | Minamino |

未入库：触发体 `festival_site_parking_lot`（无独立中文名）；IDS `seaweed_farm`（无触发体坐标）。

---

## 6. 底图

| 文件 | 尺寸 | 内容 |
|---|---|---|
| `maps/amap_base.jpg` | 4096 | 高德风陆地 / 水 / 植被 / 城区，**没有路**。3D 地形贴这张，路用 `roads.geojson` 自己画。 |
| `maps/amap_roads.png` | 8192 | 高德全图，路 + 地名 + 图例已经画上。直接当平面地图用。 |
| `maps/sat.jpg` | 4096 | 官方卫星。完整 8192 PNG 在 `out/basemap_summer.png`。 |
| `maps/height.png` / `height.npy` | 1024 | 由非隧道道路的 Y 插值。高架格子取**最低** Y，避免上层把地面抬起来。 |

高度图不是游戏地形 mesh，是路网约束出来的 DEM：路上贴着路面，远离道路的格子是最近道路高度再平滑。

---

## 7. 已知限制

* 交叉口可能有多个邻近节点，没做 junction 聚合。
* `no_right_turn` / `uturn` / `give_way` 绑在路上，还不是转弯限制表。
* 隧道节点 Y 来自 nav，和地表可能不一致。
* 像素版 GeoJSON（`out/nav_*.geojson`）坐标是 8192 底图像素，不要和本目录混用。

---

## 8. 重新打包

```bash
python tools/extract.py --game "<游戏目录>" --out out --lang CHS
python tools/pack_data.py --game "<游戏目录>" --src-out out --dest data --lang CHS
```
