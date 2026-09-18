package main

import (
	"fmt"
	"gopkg.in/yaml.v3"
	"io"
	"math"
	"net"
	"os"
	"path/filepath"
)

type Config struct {
	Data struct {
		Path string `yaml:"path"`
	} `yaml:"data"`
	HTTP struct {
		Host string `yaml:"host"`
		Port int    `yaml:"port"`
	} `yaml:"http"`
	Frontend struct {
		Path string `yaml:"path"`
	} `yaml:"frontend"`
	Telemetry struct {
		Mode          string  `yaml:"mode"`
		Host          string  `yaml:"host"`
		Port          int     `yaml:"port"`
		TimeoutMS     int     `yaml:"timeout_ms"`
		HeadingSign   float64 `yaml:"heading_sign"`
		HeadingOffset float64 `yaml:"heading_offset"`
		Forward       struct {
			Enabled bool     `yaml:"enabled"`
			Targets []string `yaml:"targets"`
		} `yaml:"forward"`
	} `yaml:"telemetry"`
}

func loadConfig(file string) (Config, error) {
	var c Config
	c.HTTP.Host = "0.0.0.0"
	c.HTTP.Port = 5173
	c.Frontend.Path = "dist"
	c.Data.Path = "data"
	c.Telemetry.Mode = "udp"
	c.Telemetry.Host = "0.0.0.0"
	c.Telemetry.Port = 9999
	c.Telemetry.TimeoutMS = 2000
	c.Telemetry.HeadingSign = 1
	f, e := os.Open(file)
	if e != nil {
		return c, e
	}
	defer f.Close()
	d := yaml.NewDecoder(f)
	d.KnownFields(true)
	if e = d.Decode(&c); e != nil {
		return c, e
	}
	var extra any
	if e = d.Decode(&extra); e != io.EOF {
		return c, fmt.Errorf("配置文件只允许一个 YAML 文档")
	}
	if e = c.validate(); e != nil {
		return c, e
	}
	if !filepath.IsAbs(c.Frontend.Path) {
		c.Frontend.Path = filepath.Join(filepath.Dir(file), c.Frontend.Path)
	}
	if !filepath.IsAbs(c.Data.Path) {
		c.Data.Path = filepath.Join(filepath.Dir(file), c.Data.Path)
	}
	c.Data.Path, e = filepath.Abs(c.Data.Path)
	if e != nil {
		return c, e
	}
	c.Frontend.Path, e = filepath.Abs(c.Frontend.Path)
	if e != nil {
		return c, e
	}
	info, e := os.Stat(filepath.Join(c.Frontend.Path, "index.html"))
	if e != nil {
		return c, fmt.Errorf("前端目录缺少 index.html: %w", e)
	}
	if info.IsDir() {
		return c, fmt.Errorf("index.html 不是文件")
	}
	return c, nil
}
func (c Config) validate() error {
	if c.HTTP.Port < 1 || c.HTTP.Port > 65535 || c.Telemetry.Port < 1 || c.Telemetry.Port > 65535 {
		return fmt.Errorf("端口必须在 1–65535 范围内")
	}
	for _, host := range []string{c.HTTP.Host, c.Telemetry.Host} {
		if net.ParseIP(host) == nil {
			return fmt.Errorf("监听 host 必须为 IP 地址: %q", host)
		}
	}
	if c.Telemetry.Mode != "udp" && c.Telemetry.Mode != "mock" {
		return fmt.Errorf("telemetry.mode 必须为 udp 或 mock")
	}
	if c.Telemetry.TimeoutMS < 100 || c.Telemetry.TimeoutMS > 60000 {
		return fmt.Errorf("timeout_ms 必须在 100–60000 范围内")
	}
	if (c.Telemetry.HeadingSign != 1 && c.Telemetry.HeadingSign != -1) || math.IsNaN(c.Telemetry.HeadingOffset) || math.IsInf(c.Telemetry.HeadingOffset, 0) {
		return fmt.Errorf("无效航向校准参数")
	}
	if c.Telemetry.Forward.Enabled && len(c.Telemetry.Forward.Targets) == 0 {
		return fmt.Errorf("启用转发时至少配置一个目标")
	}
	if len(c.Telemetry.Forward.Targets) > 32 {
		return fmt.Errorf("最多支持 32 个转发目标")
	}
	return nil
}
