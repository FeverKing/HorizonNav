package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func validPosition(p Position) bool {
	if len(p) < 2 || len(p) > 3 {
		return false
	}
	for _, v := range p {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) >= 50000 {
			return false
		}
	}
	return true
}
func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, e error) {
	status := 500
	message := "服务暂时不可用"
	var ae *apiError
	if errors.As(e, &ae) {
		status = ae.Status
		message = ae.Message
	}
	jsonResponse(w, status, map[string]string{"error": message})
}
func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	defer r.Body.Close()
	d := json.NewDecoder(r.Body)
	if e := d.Decode(v); e != nil {
		jsonResponse(w, 400, map[string]string{"error": "请求格式不正确或超过 8 KB"})
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		jsonResponse(w, 400, map[string]string{"error": "请求必须为单个 JSON 对象"})
		return false
	}
	return true
}
func newHandler(c Config, router *Router, h *telemetryHub) http.Handler {
	mux := http.NewServeMux()
	slots := make(chan struct{}, 4)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"status": "ok", "map": "Brio", "nodes": len(router.G.Positions), "telemetry": c.Telemetry.Mode})
	})
	mux.HandleFunc("GET /api/runtime", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"telemetryMode": c.Telemetry.Mode, "timeoutMs": c.Telemetry.TimeoutMS, "udpPort": c.Telemetry.Port})
	})
	mux.HandleFunc("GET /api/telemetry/status", func(w http.ResponseWriter, r *http.Request) { jsonResponse(w, 200, h.stats()) })
	mux.HandleFunc("GET /api/telemetry", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Streaming unavailable", 500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		last := int64(-1)
		wasConnected := false
		heartbeat := time.Now()
		for {
			f := h.snapshot()
			if f.Timestamp != last || f.Connected != wasConnected || time.Since(heartbeat) > 10*time.Second {
				_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5 * time.Second))
				b, _ := json.Marshal(f)
				if _, e := fmt.Fprintf(w, "data: %s\n\n", b); e != nil {
					return
				}
				flusher.Flush()
				last = f.Timestamp
				wasConnected = f.Connected
				heartbeat = time.Now()
			}
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
			}
		}
	})
	mux.HandleFunc("POST /api/route", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			From        Position `json:"from"`
			To          Position `json:"to"`
			Destination string   `json:"destination"`
		}
		if !decodeBody(w, r, &in) {
			return
		}
		if !validPosition(in.From) || !validPosition(in.To) {
			fail(w, &apiError{400, "请选择有效的起点和终点。"})
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			fail(w, &apiError{503, "算路服务繁忙，请稍后重试。"})
			return
		}
		name := []rune(in.Destination)
		if len(name) > 100 {
			name = name[:100]
		}
		if len(name) == 0 {
			name = []rune("目的地")
		}
		p, e := router.plan(in.From, in.To, string(name))
		if e != nil {
			fail(w, e)
			return
		}
		jsonResponse(w, 200, p)
	})
	mux.HandleFunc("POST /api/snap", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Position Position `json:"position"`
		}
		if !decodeBody(w, r, &in) {
			return
		}
		if !validPosition(in.Position) {
			fail(w, &apiError{400, "无效车辆坐标"})
			return
		}
		jsonResponse(w, 200, router.nearest(in.Position))
	})
	mux.HandleFunc("POST /api/mock-event", func(w http.ResponseWriter, r *http.Request) {
		if c.Telemetry.Mode != "mock" {
			fail(w, &apiError{409, "真实遥测模式不支持模拟场景"})
			return
		}
		var in struct {
			Position    Position   `json:"position"`
			Kind        string     `json:"kind"`
			RoutePoints []Position `json:"routePoints"`
		}
		if !decodeBody(w, r, &in) {
			return
		}
		if !validPosition(in.Position) || (in.Kind != "road" && in.Kind != "terrain") || len(in.RoutePoints) < 2 || len(in.RoutePoints) > 80 {
			fail(w, &apiError{400, "场景参数不正确"})
			return
		}
		for _, p := range in.RoutePoints {
			if !validPosition(p) {
				fail(w, &apiError{400, "场景参数不正确"})
				return
			}
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			fail(w, &apiError{503, "服务繁忙"})
			return
		}
		p, e := router.mockDeviation(in.Position, in.Kind, in.RoutePoints)
		if e != nil {
			fail(w, e)
			return
		}
		jsonResponse(w, 200, map[string]any{"position": p, "kind": in.Kind})
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, &apiError{404, "接口不存在"}) })
	fs := http.FileServer(http.Dir(c.Frontend.Path))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			w.WriteHeader(405)
			return
		}
		clean := filepath.Clean("/" + r.URL.Path)
		for _, part := range strings.Split(filepath.ToSlash(clean), "/") {
			if strings.HasPrefix(part, ".") {
				http.NotFound(w, r)
				return
			}
		}
		file := filepath.Join(c.Frontend.Path, clean)
		info, e := os.Stat(file)
		if e == nil && !info.IsDir() {
			if strings.HasSuffix(file, ".html") {
				w.Header().Set("Cache-Control", "no-store")
			} else {
				w.Header().Set("Cache-Control", "public, max-age=3600")
			}
			fs.ServeHTTP(w, r)
			return
		}
		if filepath.Ext(clean) != "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, filepath.Join(c.Frontend.Path, "index.html"))
	})
	return mux
}
func run() error {
	exe, e := os.Executable()
	if e != nil {
		return e
	}
	defaultConfig := filepath.Join(filepath.Dir(exe), "config.yaml")
	configFile := flag.String("config", defaultConfig, "配置文件路径（默认二进制旁的 config.yaml）")
	flag.Parse()
	c, e := loadConfig(*configFile)
	if e != nil {
		return fmt.Errorf("读取配置失败: %w", e)
	}
	router, e := loadRouter(c.Data.Path)
	if e != nil {
		return e
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	hub, e := startTelemetry(ctx, c)
	if e != nil {
		return e
	}
	defer hub.Close()
	addr := net.JoinHostPort(c.HTTP.Host, strconv.Itoa(c.HTTP.Port))
	ln, e := net.Listen("tcp", addr)
	if e != nil {
		return fmt.Errorf("HTTP 监听失败: %w", e)
	}
	srv := &http.Server{Handler: newHandler(c, router, hub), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	log.Printf("网页 http://%s | UDP %s:%d | 模式 %s", addr, c.Telemetry.Host, c.Telemetry.Port, c.Telemetry.Mode)
	log.Printf("前端目录 %s | 转发开启 %t，目标 %d", c.Frontend.Path, c.Telemetry.Forward.Enabled, len(hub.forwarders))
	done := make(chan error, 1)
	go func() { done <- srv.Serve(ln) }()
	select {
	case e = <-done:
		if !errors.Is(e, http.ErrServerClosed) {
			return e
		}
	case <-ctx.Done():
		// Close streaming requests as well as idle HTTP connections, then stop UDP workers.
		_ = srv.Close()
		<-done
	}
	return nil
}
func main() {
	if e := run(); e != nil {
		log.Print(e)
		os.Exit(1)
	}
}
