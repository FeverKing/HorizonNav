package main

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

func testRouter(t *testing.T) *Router {
	t.Helper()
	r, e := loadRouter("data")
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func TestDirectedRoutes(t *testing.T) {
	r := &Router{G: Graph{Positions: []Position{{0, 0}, {100, 0}, {100, 100}}, Indptr: []int{0, 1, 2, 3}, Indices: []int{1, 2, 0}, Weights: []float64{100, 100, 141.4}, EdgeRoads: []int{0, 0, 0}}, Roads: map[int]Road{0: {"b"}}}
	if got := r.path(1, 0, "recommended"); !reflect.DeepEqual(got.Nodes, []int{1, 2, 0}) {
		t.Fatal(got)
	}
	r.G.Indptr = []int{0, 1, 2, 2}
	if r.path(2, 0, "recommended") != nil {
		t.Fatal("unreachable route returned")
	}
}
func TestAllDestinationsAndRouteMetrics(t *testing.T) {
	r := testRouter(t)
	b, e := os.ReadFile("public/places.json")
	if e != nil {
		t.Fatal(e)
	}
	var places []struct {
		Name     string
		Position Position
	}
	if e = json.Unmarshal(b, &places); e != nil {
		t.Fatal(e)
	}
	if len(places) != 74 {
		t.Fatal(len(places))
	}
	for _, place := range places {
		p, e := r.plan(Position{-1955, -4810}, place.Position, place.Name)
		if e != nil {
			t.Fatalf("%s: %v", place.Name, e)
		}
		seen := map[string]bool{}
		for _, route := range p.Routes {
			sig, _ := json.Marshal(route.Points)
			if seen[string(sig)] {
				t.Fatal("duplicate route")
			}
			seen[string(sig)] = true
			if route.Distance <= 0 || route.Duration <= 0 || len(route.Points) != len(route.Cumulative) || len(route.Times) != len(route.Points) || math.Abs(route.Distance-route.Cumulative[len(route.Cumulative)-1]) > 0.51 {
				t.Fatal("invalid metrics", place.Name)
			}
			for i := 1; i < len(route.Cumulative); i++ {
				if route.Cumulative[i] < route.Cumulative[i-1] {
					t.Fatal("nonmonotonic")
				}
			}
			if route.Steps[len(route.Steps)-1].Kind != "arrive" {
				t.Fatal("missing arrival")
			}
		}
	}
	if _, e = r.plan(Position{-1955, -4810}, Position{-1955, -4810}, ""); e == nil {
		t.Fatal("same-node accepted")
	}
	if _, e = r.plan(Position{49000, 49000}, Position{0, 0}, ""); e == nil {
		t.Fatal("distant point accepted")
	}
}
func TestMockRecovery(t *testing.T) {
	r := testRouter(t)
	p, e := r.plan(Position{-1955, -4810}, Position{1000, 4000}, "")
	if e != nil {
		t.Fatal(e)
	}
	points := p.Routes[0].Points
	for _, kind := range []string{"road", "terrain"} {
		v, e := r.mockDeviation(points[0], kind, points)
		if e != nil {
			t.Fatal(e)
		}
		snap := r.nearest(v)
		if kind == "road" && (snap.Distance > 1 || distanceToLine(v, points) < 160) {
			t.Fatal("road event invalid")
		}
		if kind == "terrain" && snap.Distance <= 160 {
			t.Fatal("terrain event invalid")
		}
		if _, e = r.plan(snap.Position, points[len(points)-1], ""); e != nil {
			t.Fatal(e)
		}
	}
	if distanceToLine(Position{500, 30}, []Position{{0, 0}, {1000, 0}}) != 30 {
		t.Fatal("distance uses vertices instead of segments")
	}
}

func TestExternalDataValidation(t *testing.T) {
	r := testRouter(t)
	dir := t.TempDir()
	graph, _ := json.Marshal(r.G)
	roads, _ := json.Marshal(r.Roads)
	if e := os.WriteFile(dir+"/graph.json", graph, 0644); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(dir+"/roads.json", roads, 0644); e != nil {
		t.Fatal(e)
	}
	if _, e := loadRouter(dir); e != nil {
		t.Fatal("external data could not load", e)
	}
	r.G.Indices[0] = len(r.G.Positions) + 1
	graph, _ = json.Marshal(r.G)
	os.WriteFile(dir+"/graph.json", graph, 0644)
	if _, e := loadRouter(dir); e == nil {
		t.Fatal("invalid graph accepted")
	}
	os.Remove(dir + "/roads.json")
	if _, e := loadRouter(dir); e == nil {
		t.Fatal("missing data accepted")
	}
}
