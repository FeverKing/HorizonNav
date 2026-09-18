package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

type Frame struct {
	Source        string   `json:"source"`
	Connected     bool     `json:"connected"`
	Timestamp     int64    `json:"timestamp"`
	GameTimestamp uint32   `json:"gameTimestamp"`
	Position      Position `json:"position"`
	Heading       float64  `json:"heading"`
	SpeedKmh      float64  `json:"speedKmh"`
	RPM           float64  `json:"rpm"`
	Gear          int      `json:"gear"`
	Progress      float64  `json:"progress"`
}

func decodePacket(b []byte, sign, offset float64) (Frame, error) {
	if len(b) != 323 && len(b) != 324 {
		return Frame{}, fmt.Errorf("不支持的数据包长度 %d", len(b))
	}
	f := func(i int) float64 { return float64(math.Float32frombits(binary.LittleEndian.Uint32(b[i : i+4]))) }
	x, y, z, speed, yaw, rpm := f(244), f(248), f(252), f(256), f(56), f(16)
	for _, v := range []float64{x, y, z, speed, yaw, rpm} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return Frame{}, fmt.Errorf("遥测包含非有限数值")
		}
	}
	if speed < 0 || speed > 250 || math.Abs(x) > 50000 || math.Abs(z) > 50000 {
		return Frame{}, fmt.Errorf("遥测数值超出范围")
	}
	return Frame{Source: "udp", Connected: binary.LittleEndian.Uint32(b[:4]) == 1, Timestamp: time.Now().UnixMilli(), GameTimestamp: binary.LittleEndian.Uint32(b[4:8]), Position: Position{x, z, y}, Heading: math.Mod(math.Mod(yaw*180/math.Pi*sign+offset, 360)+360, 360), SpeedKmh: speed * 3.6, RPM: rpm, Gear: int(b[319])}, nil
}

type ForwardStatus struct {
	Target  string `json:"target"`
	Sent    uint64 `json:"sent"`
	Dropped uint64 `json:"dropped"`
	Errors  uint64 `json:"errors"`
}
type forwarder struct {
	target                string
	conn                  *net.UDPConn
	queue                 chan []byte
	sent, dropped, errors atomic.Uint64
}
type telemetryHub struct {
	cfg               Config
	conn              *net.UDPConn
	mu                sync.RWMutex
	frame             Frame
	received, invalid atomic.Uint64
	forwarders        []*forwarder
	cancel            context.CancelFunc
	wg                sync.WaitGroup
}

func isLocalIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsUnspecified() {
		return true
	}
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		local, _, e := net.ParseCIDR(a.String())
		if e == nil && local.Equal(ip) {
			return true
		}
	}
	return false
}
func startTelemetry(parent context.Context, c Config) (*telemetryHub, error) {
	ctx, cancel := context.WithCancel(parent)
	h := &telemetryHub{cfg: c, cancel: cancel, frame: Frame{Source: "udp", Position: Position{-1955, -4810, 110}}}
	address := net.JoinHostPort(c.Telemetry.Host, strconv.Itoa(c.Telemetry.Port))
	a, e := net.ResolveUDPAddr("udp", address)
	if e != nil {
		cancel()
		return nil, e
	}
	h.conn, e = net.ListenUDP("udp", a)
	if e != nil {
		cancel()
		return nil, fmt.Errorf("UDP 监听 %s 失败: %w", address, e)
	}
	cleanup := func(err error) (*telemetryHub, error) { h.Close(); return nil, err }
	seen := map[string]bool{}
	if c.Telemetry.Forward.Enabled {
		for _, target := range c.Telemetry.Forward.Targets {
			addr, e := net.ResolveUDPAddr("udp", target)
			if e != nil {
				return cleanup(fmt.Errorf("无效转发目标 %q: %w", target, e))
			}
			if addr.Port < 1 || addr.IP == nil || addr.IP.IsUnspecified() || addr.IP.IsMulticast() {
				return cleanup(fmt.Errorf("转发目标必须为具体的单播 IP:端口: %s", target))
			}
			if addr.Port == c.Telemetry.Port && isLocalIP(addr.IP) {
				return cleanup(fmt.Errorf("转发目标 %s 指向本服务，拒绝循环转发", target))
			}
			if seen[addr.String()] {
				continue
			}
			seen[addr.String()] = true
			conn, e := net.DialUDP("udp", nil, addr)
			if e != nil {
				return cleanup(e)
			}
			f := &forwarder{target: target, conn: conn, queue: make(chan []byte, 256)}
			h.forwarders = append(h.forwarders, f)
			h.wg.Add(1)
			go func() {
				defer h.wg.Done()
				for {
					select {
					case <-ctx.Done():
						return
					case b := <-f.queue:
						_ = f.conn.SetWriteDeadline(time.Now().Add(100 * time.Millisecond))
						if _, e := f.conn.Write(b); e != nil {
							f.errors.Add(1)
						} else {
							f.sent.Add(1)
						}
					}
				}
			}()
		}
	}
	_ = h.conn.SetReadBuffer(1024 * 1024)
	h.wg.Add(1)
	go func() {
		defer h.wg.Done()
		b := make([]byte, 65535)
		for {
			n, _, e := h.conn.ReadFromUDP(b)
			if e != nil {
				return
			}
			h.received.Add(1)
			// Forward raw bytes, even when this application's decoder does not recognize the format.
			if len(h.forwarders) > 0 {
				packet := append([]byte(nil), b[:n]...)
				for _, f := range h.forwarders {
					select {
					case f.queue <- packet:
					default:
						f.dropped.Add(1)
					}
				}
			}
			frame, e := decodePacket(b[:n], c.Telemetry.HeadingSign, c.Telemetry.HeadingOffset)
			if e != nil {
				h.invalid.Add(1)
				continue
			}
			h.mu.Lock()
			h.frame = frame
			h.mu.Unlock()
		}
	}()
	return h, nil
}
func (h *telemetryHub) Close() {
	h.cancel()
	if h.conn != nil {
		_ = h.conn.Close()
	}
	for _, f := range h.forwarders {
		_ = f.conn.Close()
	}
	h.wg.Wait()
}
func (h *telemetryHub) snapshot() Frame {
	h.mu.RLock()
	f := h.frame
	h.mu.RUnlock()
	if time.Now().UnixMilli()-f.Timestamp > int64(h.cfg.Telemetry.TimeoutMS) {
		f.Connected = false
	}
	if !f.Connected {
		f.SpeedKmh = 0
	}
	return f
}
func (h *telemetryHub) stats() map[string]any {
	targets := []ForwardStatus{}
	for _, f := range h.forwarders {
		targets = append(targets, ForwardStatus{f.target, f.sent.Load(), f.dropped.Load(), f.errors.Load()})
	}
	f := h.snapshot()
	return map[string]any{"connected": f.Connected, "received": h.received.Load(), "invalid": h.invalid.Load(), "lastPacketAt": f.Timestamp, "forwarding": h.cfg.Telemetry.Forward.Enabled, "targets": targets}
}
