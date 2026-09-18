package main

import (
	"container/heap"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

type Position []float64
type Graph struct {
	Positions []Position `json:"positions"`
	Indptr    []int      `json:"indptr"`
	Indices   []int      `json:"indices"`
	Weights   []float64  `json:"weights"`
	EdgeRoads []int      `json:"edgeRoads"`
}
type Road struct {
	Type string `json:"road_type"`
}
type Router struct {
	G     Graph
	Roads map[int]Road
}
type Snap struct {
	Node     int      `json:"node"`
	Distance float64  `json:"distance"`
	Position Position `json:"position"`
	OffRoad  bool     `json:"offRoad"`
}
type Step struct {
	At    float64 `json:"at"`
	Index int     `json:"index"`
	Kind  string  `json:"kind"`
	Text  string  `json:"text"`
	Road  string  `json:"road"`
}
type Route struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Profiles   []string   `json:"profiles"`
	Points     []Position `json:"points"`
	Cumulative []float64  `json:"cumulative"`
	Times      []float64  `json:"times"`
	Distance   float64    `json:"distance"`
	Duration   float64    `json:"duration"`
	Unpaved    float64    `json:"unpaved"`
	Highway    float64    `json:"highway"`
	Steps      []Step     `json:"steps"`
}
type Plan struct {
	Routes []*Route `json:"routes"`
	Snap   struct {
		From         float64  `json:"from"`
		To           float64  `json:"to"`
		FromPosition Position `json:"fromPosition"`
		ToPosition   Position `json:"toPosition"`
	} `json:"snap"`
}
type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string { return e.Message }

var speeds = map[string]float64{"freeway": 120, "a": 80, "b": 65, "hidden": 45, "dirt": 45, "trail": 30, "shortcut": 35, "evolving_world": 40}
var roadNames = map[string]string{"freeway": "高速公路", "a": "主干道", "b": "城市道路", "hidden": "支路", "dirt": "砂石路", "trail": "山间小径", "shortcut": "近道", "evolving_world": "季节道路"}

func loadRouter(dir string) (*Router, error) {
	r := &Router{}
	b, e := os.ReadFile(filepath.Join(dir, "graph.json"))
	if e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &r.G); e != nil {
		return nil, e
	}
	b, e = os.ReadFile(filepath.Join(dir, "roads.json"))
	if e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &r.Roads); e != nil {
		return nil, e
	}
	if e = r.validate(); e != nil {
		return nil, e
	}
	return r, nil
}
func (r *Router) nearest(p Position) Snap {
	s := Snap{Node: -1, Distance: math.Inf(1)}
	for i, q := range r.G.Positions {
		d := math.Hypot(q[0]-p[0], q[1]-p[1])
		if d < s.Distance {
			s = Snap{Node: i, Distance: d, Position: q, OffRoad: d > 160}
		}
	}
	return s
}

type item struct {
	Cost float64
	Node int
}
type queue []item

func (q queue) Len() int           { return len(q) }
func (q queue) Less(i, j int) bool { return q[i].Cost < q[j].Cost }
func (q queue) Swap(i, j int)      { q[i], q[j] = q[j], q[i] }
func (q *queue) Push(x any)        { *q = append(*q, x.(item)) }
func (q *queue) Pop() any          { old := *q; x := old[len(old)-1]; *q = old[:len(old)-1]; return x }

type routePath struct{ Nodes, Edges []int }

func (r *Router) roadType(k int) string {
	t := r.Roads[r.G.EdgeRoads[k]].Type
	if t == "" {
		return "b"
	}
	return t
}
func speed(t string) float64 {
	if v := speeds[t]; v > 0 {
		return v
	}
	return 50
}
func (r *Router) path(start, end int, profile string) *routePath {
	g := &r.G
	n := len(g.Positions)
	cost := make([]float64, n)
	parents := make([]int, n)
	arcs := make([]int, n)
	for i := range cost {
		cost[i] = math.Inf(1)
		parents[i] = -1
	}
	cost[start] = 0
	q := &queue{{0, start}}
	heap.Init(q)
	for q.Len() > 0 {
		it := heap.Pop(q).(item)
		u := it.Node
		if it.Cost != cost[u] {
			continue
		}
		if u == end {
			break
		}
		for k := g.Indptr[u]; k < g.Indptr[u+1]; k++ {
			v := g.Indices[k]
			t := r.roadType(k)
			factor := 1.0
			if profile == "noHighway" {
				if t == "freeway" {
					factor = 6
				} else if t == "trail" {
					factor = 2.4
				}
			} else if profile != "shortest" {
				factor = 3.6 / speed(t)
				if t == "trail" || t == "shortcut" {
					factor *= 1.8
				}
			}
			nd := it.Cost + g.Weights[k]*factor
			if nd < cost[v] {
				cost[v] = nd
				parents[v] = u
				arcs[v] = k
				heap.Push(q, item{nd, v})
			}
		}
	}
	if math.IsInf(cost[end], 1) {
		return nil
	}
	p := &routePath{}
	for v := end; v != start; v = parents[v] {
		p.Nodes = append(p.Nodes, v)
		p.Edges = append(p.Edges, arcs[v])
	}
	p.Nodes = append(p.Nodes, start)
	for i, j := 0, len(p.Nodes)-1; i < j; i, j = i+1, j-1 {
		p.Nodes[i], p.Nodes[j] = p.Nodes[j], p.Nodes[i]
	}
	for i, j := 0, len(p.Edges)-1; i < j; i, j = i+1, j-1 {
		p.Edges[i], p.Edges[j] = p.Edges[j], p.Edges[i]
	}
	return p
}
func heading(a, b Position) float64 { return math.Atan2(b[0]-a[0], b[1]-a[1]) * 180 / math.Pi }
func (r *Router) describe(p *routePath, profile, destination string) *Route {
	out := &Route{ID: profile, Label: map[string]string{"recommended": "推荐路线", "shortest": "距离最短", "noHighway": "少走高速"}[profile], Profiles: []string{profile}, Cumulative: []float64{0}, Times: []float64{0}}
	for _, n := range p.Nodes {
		out.Points = append(out.Points, r.G.Positions[n])
	}
	for _, k := range p.Edges {
		t := r.roadType(k)
		m := r.G.Weights[k]
		out.Distance += m
		out.Duration += m / speed(t) * 3.6
		out.Cumulative = append(out.Cumulative, out.Distance)
		out.Times = append(out.Times, out.Duration)
		if t == "dirt" || t == "trail" || t == "shortcut" {
			out.Unpaved += m
		}
		if t == "freeway" {
			out.Highway += m
		}
	}
	out.Steps = []Step{{At: 0, Index: 0, Kind: "straight", Text: "沿当前道路行驶", Road: roadNames[r.roadType(p.Edges[0])]}}
	for i := 2; i < len(out.Points)-2; i++ {
		prev, next := p.Edges[i-1], p.Edges[i]
		t, pt := r.roadType(next), r.roadType(prev)
		angle := math.Mod(heading(out.Points[i], out.Points[min(i+3, len(out.Points)-1)])-heading(out.Points[max(0, i-3)], out.Points[i])+540, 360) - 180
		if out.Cumulative[i]-out.Steps[len(out.Steps)-1].At < 90 || out.Distance-out.Cumulative[i] < 70 {
			continue
		}
		if (r.G.EdgeRoads[prev] != r.G.EdgeRoads[next] && math.Abs(angle) > 30) || (t == "freeway" && pt != "freeway") {
			kind, verb := "straight", "直行"
			if math.Abs(angle) > 150 {
				kind, verb = "uturn", "掉头"
			} else if angle > 28 {
				kind, verb = "right", "右转"
			} else if angle < -28 {
				kind, verb = "left", "左转"
			}
			road := roadNames[t]
			if road == "" {
				road = "连接道路"
			}
			out.Steps = append(out.Steps, Step{out.Cumulative[i], i, kind, verb + "进入" + road, road})
		}
	}
	out.Steps = append(out.Steps, Step{out.Distance, len(out.Points) - 1, "arrive", "到达" + destination, destination})
	out.Distance = math.Round(out.Distance)
	out.Duration = math.Round(out.Duration)
	out.Unpaved = math.Round(out.Unpaved)
	out.Highway = math.Round(out.Highway)
	return out
}
func (r *Router) plan(from, to Position, destination string) (*Plan, error) {
	a, b := r.nearest(from), r.nearest(to)
	if a.Distance > 1500 || b.Distance > 1500 {
		return nil, &apiError{422, "所选位置离路网较远，请选择道路附近的位置。"}
	}
	if a.Node == b.Node {
		return nil, &apiError{422, "起点与终点位于同一路段，请选择更远的目的地。"}
	}
	result := &Plan{}
	seen := map[string]*Route{}
	for _, profile := range []string{"recommended", "shortest", "noHighway"} {
		p := r.path(a.Node, b.Node, profile)
		if p == nil {
			continue
		}
		sig := fmt.Sprint(p.Nodes)
		if old := seen[sig]; old != nil {
			old.Profiles = append(old.Profiles, profile)
			continue
		}
		rt := r.describe(p, profile, destination)
		seen[sig] = rt
		result.Routes = append(result.Routes, rt)
	}
	if len(result.Routes) == 0 {
		return nil, &apiError{409, "无法沿可通行道路到达该位置，请更换起点或终点。"}
	}
	result.Snap.From = a.Distance
	result.Snap.To = b.Distance
	result.Snap.FromPosition = a.Position
	result.Snap.ToPosition = b.Position
	return result, nil
}
func distanceToLine(p Position, points []Position) float64 {
	best := math.Inf(1)
	for i := 1; i < len(points); i++ {
		a, b := points[i-1], points[i]
		dx, dz := b[0]-a[0], b[1]-a[1]
		den := dx*dx + dz*dz
		t := 0.0
		if den > 0 {
			t = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dz)/den))
		}
		best = min(best, math.Hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dz))
	}
	return best
}
func (r *Router) mockDeviation(p Position, kind string, points []Position) (Position, error) {
	var best Position
	score := math.Inf(1)
	if kind == "road" {
		for _, v := range r.G.Positions {
			d := math.Hypot(v[0]-p[0], v[1]-p[1])
			if d < 300 || d > 2000 || distanceToLine(v, points) < 160 {
				continue
			}
			s := math.Abs(d - 700)
			if s < score {
				score = s
				best = v
			}
		}
	} else {
		distance := 0.0
		for _, radius := range []float64{400, 700, 1100, 1600} {
			for a := 0; a < 16; a++ {
				theta := float64(a) * math.Pi / 8
				v := Position{p[0] + math.Cos(theta)*radius, p[1] + math.Sin(theta)*radius, 100}
				snap := r.nearest(v)
				if snap.Distance > distance && distanceToLine(v, points) > 200 {
					distance = snap.Distance
					best = v
				}
			}
		}
		if distance <= 160 {
			best = nil
		}
	}
	if best == nil {
		return nil, &apiError{422, "附近暂无适合的偏航位置，请行驶一段距离后重试。"}
	}
	return best, nil
}

// External datasets are validated before any requests are accepted.
func (r *Router) validate() error {
	g := &r.G
	n, arcs := len(g.Positions), len(g.Indices)
	if n < 2 || len(g.Indptr) != n+1 || len(g.Weights) != arcs || len(g.EdgeRoads) != arcs || g.Indptr[0] != 0 || g.Indptr[n] != arcs {
		return fmt.Errorf("路网 CSR 数组长度不一致")
	}
	for i, p := range g.Positions {
		if !validPosition(p) {
			return fmt.Errorf("节点 %d 坐标无效", i)
		}
		if g.Indptr[i] < 0 || g.Indptr[i] > g.Indptr[i+1] || g.Indptr[i+1] > arcs {
			return fmt.Errorf("节点 %d 索引无效", i)
		}
	}
	for i, v := range g.Indices {
		if v < 0 || v >= n || math.IsNaN(g.Weights[i]) || math.IsInf(g.Weights[i], 0) || g.Weights[i] <= 0 {
			return fmt.Errorf("路段 %d 数据无效", i)
		}
		// -1 denotes the four unnamed connector arcs in the supplied dataset.
		if _, ok := r.Roads[g.EdgeRoads[i]]; !ok && g.EdgeRoads[i] != -1 {
			return fmt.Errorf("路段 %d 缺少道路元数据", i)
		}
	}
	return nil
}
