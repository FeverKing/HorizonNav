package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func testPacket() []byte {
	b := make([]byte, 324)
	binary.LittleEndian.PutUint32(b, 1)
	for offset, v := range map[int]float32{244: -1955, 248: 110, 252: -4810, 256: 25, 56: float32(math.Pi / 2), 16: 3200} {
		binary.LittleEndian.PutUint32(b[offset:], math.Float32bits(v))
	}
	b[319] = 4
	return b
}
func testConfig(t *testing.T) Config {
	t.Helper()
	var c Config
	c.HTTP.Host = "127.0.0.1"
	c.HTTP.Port = 5173
	c.Telemetry.Host = "127.0.0.1"
	c.Telemetry.Mode = "udp"
	c.Telemetry.TimeoutMS = 150
	c.Telemetry.HeadingSign = 1
	c.Frontend.Path = t.TempDir()
	if e := os.WriteFile(filepath.Join(c.Frontend.Path, "index.html"), []byte("<main>Horizon</main>"), 0644); e != nil {
		t.Fatal(e)
	}
	return c
}
func udpSink(t *testing.T) *net.UDPConn {
	t.Helper()
	c, e := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { c.Close() })
	return c
}
func sendPacket(t *testing.T, h *telemetryHub, b []byte) {
	t.Helper()
	c, e := net.DialUDP("udp", nil, h.conn.LocalAddr().(*net.UDPAddr))
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	if _, e = c.Write(b); e != nil {
		t.Fatal(e)
	}
}
func waitFor(t *testing.T, f func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if f() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition timed out")
}
func TestDecodeAndValidation(t *testing.T) {
	b := testPacket()
	f, e := decodePacket(b, 1, 0)
	if e != nil || f.SpeedKmh != 90 || math.Abs(f.Heading-90) > 0.001 || f.Position[1] != -4810 || f.Position[2] != 110 || f.Gear != 4 {
		t.Fatal(f, e)
	}
	f, e = decodePacket(b, -1, 90)
	if e != nil || math.Min(math.Abs(f.Heading), math.Abs(360-f.Heading)) > 0.001 {
		t.Fatal(f, e)
	}
	if _, e = decodePacket(b[:323], 1, 0); e != nil {
		t.Fatal(e)
	}
	if _, e = decodePacket(b[:100], 1, 0); e == nil {
		t.Fatal("unknown size accepted")
	}
	binary.LittleEndian.PutUint32(b[244:], math.Float32bits(float32(math.NaN())))
	if _, e = decodePacket(b, 1, 0); e == nil {
		t.Fatal("NaN accepted")
	}
}
func TestUDPForwardMultipleAndTimeout(t *testing.T) {
	a, b := udpSink(t), udpSink(t)
	c := testConfig(t)
	c.Telemetry.Forward.Enabled = true
	c.Telemetry.Forward.Targets = []string{a.LocalAddr().String(), b.LocalAddr().String()}
	h, e := startTelemetry(context.Background(), c)
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	packet := testPacket()
	sendPacket(t, h, packet)
	for _, sink := range []*net.UDPConn{a, b} {
		sink.SetReadDeadline(time.Now().Add(time.Second))
		buf := make([]byte, 1000)
		n, _, e := sink.ReadFromUDP(buf)
		if e != nil || !bytes.Equal(buf[:n], packet) {
			t.Fatal("forward bytes differ", e)
		}
	}
	waitFor(t, func() bool { return h.snapshot().Connected })
	waitFor(t, func() bool { return !h.snapshot().Connected })
	if h.snapshot().SpeedKmh != 0 {
		t.Fatal("stale speed")
	}
	// Unknown formats are forwarded unchanged, but cannot update the decoded frame.
	raw := []byte("unknown-packet-format")
	sendPacket(t, h, raw)
	for _, sink := range []*net.UDPConn{a, b} {
		sink.SetReadDeadline(time.Now().Add(time.Second))
		buf := make([]byte, 1000)
		n, _, e := sink.ReadFromUDP(buf)
		if e != nil || !bytes.Equal(buf[:n], raw) {
			t.Fatal("unknown raw packet not relayed", e)
		}
	}
	waitFor(t, func() bool { return h.invalid.Load() == 1 })
	if h.received.Load() != 2 {
		t.Fatal("received counter")
	}
}
func TestForwardDisabledAndSelfLoopRejected(t *testing.T) {
	sink := udpSink(t)
	c := testConfig(t)
	c.Telemetry.Forward.Targets = []string{sink.LocalAddr().String()}
	h, e := startTelemetry(context.Background(), c)
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	sendPacket(t, h, testPacket())
	waitFor(t, func() bool { return h.snapshot().Connected })
	sink.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	if _, _, e = sink.ReadFromUDP(make([]byte, 1000)); e == nil {
		t.Fatal("forwarded while disabled")
	}
	reservation := udpSink(t)
	port := reservation.LocalAddr().(*net.UDPAddr).Port
	reservation.Close()
	c.Telemetry.Port = port
	c.Telemetry.Forward.Enabled = true
	c.Telemetry.Forward.Targets = []string{net.JoinHostPort("127.0.0.1", stringPort(port))}
	if h, e = startTelemetry(context.Background(), c); e == nil {
		h.Close()
		t.Fatal("self forwarding allowed")
	}
}
func stringPort(p int) string { return strconv.Itoa(p) }
func TestConfigRelativePathAndUnknownFields(t *testing.T) {
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "web"), 0755)
	os.WriteFile(filepath.Join(dir, "web/index.html"), []byte("hi"), 0644)
	file := filepath.Join(dir, "config.yaml")
	os.WriteFile(file, []byte("frontend:\n  path: web\n"), 0644)
	c, e := loadConfig(file)
	if e != nil || c.Frontend.Path != filepath.Join(dir, "web") {
		t.Fatal(c, e)
	}
	for _, bad := range []string{"http:\n  port: 0\n", "telemetry:\n  mode: other\n", "http:\n  prt: 5\n", "telemetry:\n  forward:\n    enabled: true\n"} {
		os.WriteFile(file, []byte(bad), 0644)
		if _, e = loadConfig(file); e == nil {
			t.Fatal("bad config accepted", bad)
		}
	}
}
func TestHTTPAndSSE(t *testing.T) {
	c := testConfig(t)
	c.Telemetry.TimeoutMS = 1000
	h, e := startTelemetry(context.Background(), c)
	if e != nil {
		t.Fatal(e)
	}
	defer h.Close()
	server := httptest.NewServer(newHandler(c, testRouter(t), h))
	defer server.Close()
	for _, check := range []struct {
		path   string
		status int
	}{{"/", 200}, {"/navigation", 200}, {"/api/health", 200}, {"/api/runtime", 200}, {"/api/not-found", 404}, {"/missing.js", 404}} {
		r, e := http.Get(server.URL + check.path)
		if e != nil {
			t.Fatal(e)
		}
		r.Body.Close()
		if r.StatusCode != check.status {
			t.Fatal(check, r.StatusCode)
		}
	}
	r, e := http.Post(server.URL+"/api/route", "application/json", strings.NewReader(`{"from":[-1955,-4810],"to":[1000,4000],"destination":"目的地"}`))
	if e != nil {
		t.Fatal(e)
	}
	var plan Plan
	json.NewDecoder(r.Body).Decode(&plan)
	r.Body.Close()
	if r.StatusCode != 200 || len(plan.Routes) == 0 {
		t.Fatal("route HTTP failed")
	}
	r, e = http.Post(server.URL+"/api/route", "application/json", strings.NewReader(`{"from":[0],"to":[1,2]}`))
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode != 400 {
		t.Fatal("bad input not rejected")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/telemetry", nil)
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	reader := bufio.NewReader(res.Body)
	sendPacket(t, h, testPacket())
	for {
		line, e := reader.ReadString('\n')
		if e != nil {
			t.Fatal(e)
		}
		if strings.HasPrefix(line, "data: ") {
			var f Frame
			json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &f)
			if f.Connected {
				if f.SpeedKmh != 90 {
					t.Fatal(f)
				}
				break
			}
		}
	}
	r, e = http.Get(server.URL + "/api/telemetry/status")
	if e != nil {
		t.Fatal(e)
	}
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if !bytes.Contains(b, []byte(`"received":1`)) {
		t.Fatal(string(b))
	}
}
