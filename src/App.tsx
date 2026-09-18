import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Flag,
  Heart,
  Layers,
  LoaderCircle,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Maximize,
  Minus,
  Mountain,
  Navigation,
  Navigation2,
  ParkingCircle,
  Pause,
  Play,
  Plus,
  Radio,
  Route as RouteIcon,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Volume2,
  VolumeX,
  X,
  CornerUpLeft,
  CornerUpRight,
  Undo2,
  CheckCircle2,
  CarFront,
  RotateCcw,
} from "lucide-react";
import { useRecovery } from "./useRecovery";
import MapView from "./MapView";
import type { MapControls } from "./MapView";
import type { Mode, Place, Plan, Position, Region, Settings } from "./types";
import { sampleRoute, useMockTelemetry } from "./telemetry";
const INITIAL: Place = {
  id: "current",
  name: "我的位置",
  en: "Tokyo · Brio",
  position: [-1955, -4810, 110],
  category: "position",
  region: "东京市",
};
const defaultSettings: Settings = { speed: 90, rate: 1, voice: false };
const categories = [
  { id: "all", name: "全部", icon: Compass },
  { id: "scenic", name: "风景地标", icon: Mountain },
  { id: "racing", name: "赛道", icon: Flag },
  { id: "parking", name: "停车区", icon: ParkingCircle },
];
const labelCategory = (c: string) =>
  c === "parking"
    ? "停车区"
    : c === "racing"
      ? "赛事与嘉年华"
      : c === "point"
        ? "地图选点"
        : "风景地标";
const distance = (m: number) =>
  m >= 1000
    ? `${(m / 1000).toFixed(1)}公里`
    : `${Math.max(0, Math.round(m / 10) * 10)}米`;
const time = (s: number) =>
  s >= 3600
    ? `${Math.floor(s / 3600)}小时${Math.ceil((s % 3600) / 60)}分钟`
    : `${Math.max(1, Math.ceil(s / 60))}分钟`;
const arrival = (s: number) =>
  new Date(Date.now() + s * 1000).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
function readStored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function saveStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private storage may be unavailable. The current session still works. */
  }
}
function TurnIcon({ kind, size = 32 }: { kind: string; size?: number }) {
  const Icon =
    kind === "right"
      ? CornerUpRight
      : kind === "left"
        ? CornerUpLeft
        : kind === "uturn"
          ? Undo2
          : kind === "arrive"
            ? Flag
            : ArrowUp;
  return <Icon size={size} strokeWidth={2.8} />;
}
function PlaceIcon({ category }: { category: string }) {
  const Icon =
    category === "parking"
      ? ParkingCircle
      : category === "racing"
        ? Flag
        : category === "point"
          ? MapPin
          : Mountain;
  return (
    <span className={`place-icon ${category}`}>
      <Icon size={19} />
    </span>
  );
}
function SettingsDialog({
  settings,
  onChange,
  onClose,
  onReset,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="settings-dialog"
      onCancel={onClose}
      aria-labelledby="settings-title"
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-head">
        <div>
          <span className="eyebrow">驾驶设置</span>
          <h2 id="settings-title">遥测与导航</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭设置">
          <X size={20} />
        </button>
      </div>
      <div className="connection-block">
        <span className="connection-icon">
          <Radio size={23} />
        </span>
        <div>
          <strong>模拟遥测已连接</strong>
          <p>沿规划路线驱动车辆位置与航向</p>
        </div>
        <span className="status-dot" />
      </div>
      <div className="setting-row">
        <div>
          <strong>模拟车速</strong>
          <p>用于路线回放，非实际游戏速度</p>
        </div>
        <b>
          {settings.speed}
          <small> km/h</small>
        </b>
      </div>
      <input
        aria-label="模拟车速"
        className="speed-range"
        type="range"
        min="30"
        max="180"
        step="10"
        value={settings.speed}
        onChange={(e) =>
          onChange({ ...settings, speed: Number(e.target.value) })
        }
      />
      <div className="range-labels">
        <span>30 km/h</span>
        <span>180 km/h</span>
      </div>
      <div className="setting-row">
        <div>
          <strong>回放倍率</strong>
          <p>加速行驶进度，便于检查长途路线</p>
        </div>
      </div>
      <div className="segmented">
        {[1, 10, 30].map((r) => (
          <button
            key={r}
            className={settings.rate === r ? "active" : ""}
            onClick={() => onChange({ ...settings, rate: r })}
          >
            {r}×
          </button>
        ))}
      </div>
      <div className="setting-row bordered">
        <div>
          <strong>语音播报</strong>
          <p>
            {"speechSynthesis" in window
              ? "播报下一次转向与到达提示"
              : "当前浏览器不支持语音播报"}
          </p>
        </div>
        <button
          role="switch"
          aria-label="语音播报"
          aria-checked={settings.voice}
          disabled={!("speechSynthesis" in window)}
          className={`switch ${settings.voice ? "on" : ""}`}
          onClick={() => onChange({ ...settings, voice: !settings.voice })}
        >
          <span />
        </button>
      </div>
      <div className="protocol-note">
        <ShieldCheck size={18} />
        <p>
          当前使用模拟数据。真实游戏遥测尚未连接；接入时可复用同一位置、速度与航向接口。
        </p>
      </div>
      <button className="secondary full" onClick={onReset}>
        <RotateCcw size={16} />
        恢复默认设置
      </button>
      <button className="primary full" onClick={onClose}>
        完成
      </button>
    </dialog>
  );
}
export default function App() {
  const [data, setData] = useState<{
      places: Place[];
      regions: Region[];
      roads: GeoJSON.FeatureCollection;
    } | null>(null),
    [loadError, setLoadError] = useState(""),
    [reload, setReload] = useState(0),
    [mapReady, setMapReady] = useState(false);
  const [mode, setMode] = useState<Mode>("browse"),
    [destination, setDestination] = useState<Place | null>(null),
    [origin, setOrigin] = useState<Place>(INITIAL),
    [plan, setPlan] = useState<Plan | null>(null),
    [routeId, setRouteId] = useState(""),
    [calculating, setCalculating] = useState(false),
    [routeError, setRouteError] = useState(""),
    [revision, setRevision] = useState(0);
  const [navRun, setNavRun] = useState(0);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false),
    [scenariosOpen, setScenariosOpen] = useState(false);
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [tab, setTab] = useState("explore"),
    [satellite, setSatellite] = useState(false),
    [layersOpen, setLayersOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [paused, setPaused] = useState(false),
    [follow, setFollow] = useState(false),
    [pickingOrigin, setPickingOrigin] = useState(false),
    [stepsOpen, setStepsOpen] = useState(false),
    [toast, setToast] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => {
      const s = readStored<unknown>("horizon.favorites", []);
      return Array.isArray(s) ? s.filter((v) => typeof v === "string") : [];
    }),
    [history, setHistory] = useState<string[]>(() => {
      const s = readStored<unknown>("horizon.history", []);
      return Array.isArray(s) ? s.filter((v) => typeof v === "string") : [];
    });
  const [settings, setSettings] = useState<Settings>(() => {
    const s = readStored<Partial<Settings>>("horizon.settings", {});
    return {
      ...defaultSettings,
      speed: Number.isFinite(s?.speed)
        ? Math.max(30, Math.min(180, s.speed!))
        : 90,
      rate: [1, 10, 30].includes(s?.rate || 0) ? s.rate! : 1,
      voice: s?.voice === true,
    };
  });
  const map = useRef<MapControls>(null),
    search = useRef<HTMLInputElement>(null),
    spoken = useRef("");
  const route = plan?.routes.find((r) => r.id === routeId) || plan?.routes[0],
    navigating = mode === "navigation",
    rawFrame = useMockTelemetry(
      route,
      navigating,
      paused || recoveryBlocked,
      settings,
      origin.position,
      navRun,
    );
  const recovery = useRecovery({
    active: navigating,
    route,
    destination,
    raw: rawFrame,
    paused,
    settings,
    onPlan: (p) => {
      setPlan(p);
      setRouteId(p.routes.find((r) => r.id === routeId)?.id || p.routes[0].id);
    },
    onBlock: setRecoveryBlocked,
    onMessage: setToast,
  });
  const frame = recovery.frame;
  useEffect(() => {
    const ctrl = new AbortController();
    setLoadError("");
    Promise.all(
      ["places", "regions", "roads"].map((k) =>
        fetch(`/${k}.json`, { signal: ctrl.signal }).then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        }),
      ),
    )
      .then(([places, regions, roads]) => setData({ places, regions, roads }))
      .catch((e) => {
        if (e.name !== "AbortError")
          setLoadError("地图数据未能加载，请检查本地服务后重试。");
      });
    return () => ctrl.abort();
  }, [reload]);
  useEffect(() => {
    saveStored("horizon.favorites", favorites);
  }, [favorites]);
  useEffect(() => {
    saveStored("horizon.history", history);
  }, [history]);
  useEffect(() => {
    saveStored("horizon.settings", settings);
  }, [settings]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!destination) return;
    const ctrl = new AbortController();
    setCalculating(true);
    setRouteError("");
    setPlan(null);
    fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: origin.position,
        to: destination.position,
        destination: destination.name,
      }),
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || "路线计算失败");
        return result as Plan;
      })
      .then((p) => {
        setPlan(p);
        setRouteId(p.routes[0].id);
        setCalculating(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setRouteError(
            e.message === "Failed to fetch"
              ? "无法连接算路服务，请确认服务正在运行。"
              : e.message,
          );
          setCalculating(false);
        }
      });
    return () => ctrl.abort();
  }, [destination, origin, revision]);
  useEffect(() => {
    if (
      navigating &&
      !recoveryBlocked &&
      frame.session === navRun &&
      route &&
      frame.progress >= route.distance
    ) {
      setMode("arrived");
      setPaused(false);
      if (settings.voice && "speechSynthesis" in window) {
        const s = new SpeechSynthesisUtterance(
          "已到达目的地附近，本次导航结束",
        );
        s.lang = "zh-CN";
        speechSynthesis.speak(s);
      }
    }
  }, [
    frame.progress,
    frame.session,
    navRun,
    navigating,
    route,
    settings.voice,
    recoveryBlocked,
  ]);
  const nextStep =
      route?.steps.find((s) => s.at > frame.progress + 8) ||
      route?.steps.at(-1),
    remaining = route ? Math.max(0, route.distance - frame.progress) : 0,
    remainingTime = route
      ? Math.max(0, route.duration - sampleRoute(route, frame.progress).time)
      : 0;
  useEffect(() => {
    if (
      !navigating ||
      recoveryBlocked ||
      paused ||
      !settings.voice ||
      !nextStep ||
      !("speechSynthesis" in window)
    )
      return;
    const key = `${routeId}:${nextStep.index}`;
    if (spoken.current === key) return;
    spoken.current = key;
    const speech = new SpeechSynthesisUtterance(
      `前方${distance(nextStep.at - frame.progress)}，${nextStep.text}`,
    );
    speech.lang = "zh-CN";
    speechSynthesis.cancel();
    speechSynthesis.speak(speech);
  }, [
    navigating,
    recoveryBlocked,
    paused,
    settings.voice,
    nextStep,
    routeId,
    frame.progress,
  ]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key === "Escape") {
        setQuery("");
        setLayersOpen(false);
        setPickingOrigin(false);
        setStepsOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const selectPlace = useCallback(
    (p: Place) => {
      if (navigating) return;
      if (pickingOrigin) {
        setOrigin(p);
        setPickingOrigin(false);
        setQuery("");
        return;
      }
      setDestination(p);
      setMode("routes");
      setQuery("");
      setStepsOpen(false);
      setHistory((h) => [p.id, ...h.filter((id) => id !== p.id)].slice(0, 8));
    },
    [pickingOrigin, navigating],
  );
  const selectPoint = useCallback(
    (p: Position) => {
      if (navigating) return;
      selectPlace({
        id: `point-${Math.round(p[0])}-${Math.round(p[1])}`,
        name: pickingOrigin ? "自选起点" : "地图选点",
        en: `X ${Math.round(p[0])} · Z ${Math.round(p[1])}`,
        position: p,
        category: "point",
        region: "Brio",
      });
    },
    [selectPlace, pickingOrigin, navigating],
  );
  const back = () => {
    if (mode === "arrived")
      setOrigin({
        ...INITIAL,
        position: frame.position,
        region: destination?.region || "Brio",
        en: "Brio",
      });
    setMode("browse");
    setDestination(null);
    setPlan(null);
    setQuery("");
    setRouteError("");
    setPickingOrigin(false);
    setStepsOpen(false);
  };
  const toggleFavorite = (p: Place) => {
    if (p.category === "point") {
      setToast("请收藏地图中已命名的地点");
      return;
    }
    setFavorites((ids) =>
      ids.includes(p.id) ? ids.filter((i) => i !== p.id) : [...ids, p.id],
    );
  };
  const start = () => {
    if (!route) return;
    setNavRun((v) => v + 1);
    setMode("navigation");
    setPaused(false);
    setFollow(true);
    setPickingOrigin(false);
    setStepsOpen(false);
    spoken.current = "";
  };
  const stop = () => {
    setOrigin({
      ...INITIAL,
      position: frame.position,
      region: "Brio",
      en: "当前位置",
    });
    setMode("routes");
    setPaused(false);
    setFollow(false);
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  };
  const visiblePlaces = useMemo(() => {
    if (!data) return [];
    let list = data.places.filter(
      (p) => category === "all" || p.category === category,
    );
    if (tab === "saved") list = list.filter((p) => favorites.includes(p.id));
    if (query.trim()) {
      const q = query.trim().toLocaleLowerCase();
      list = list.filter((p) =>
        `${p.name} ${p.en} ${p.region}`.toLocaleLowerCase().includes(q),
      );
    }
    return list.sort(
      (a, b) =>
        Math.hypot(
          a.position[0] - origin.position[0],
          a.position[1] - origin.position[1],
        ) -
        Math.hypot(
          b.position[0] - origin.position[0],
          b.position[1] - origin.position[1],
        ),
    );
  }, [data, category, tab, favorites, query, origin]);
  const recent =
    data?.places
      .filter((p) => history.includes(p.id))
      .sort((a, b) => history.indexOf(a.id) - history.indexOf(b.id))
      .slice(0, 3) || [];
  const updateSettings = (s: Settings) => setSettings(s);
  const browseContent = mode === "browse" || pickingOrigin || query.length > 0;
  if (loadError)
    return (
      <div className="fatal-state">
        <MapIcon size={40} />
        <h1>地图暂时不可用</h1>
        <p>{loadError}</p>
        <button className="primary" onClick={() => setReload((v) => v + 1)}>
          重新加载
        </button>
      </div>
    );
  return (
    <div className={`app mode-${mode}`}>
      <main className="workspace">
        {data && (
          <MapView
            ref={map}
            places={data.places}
            regions={data.regions}
            roads={data.roads}
            routes={plan?.routes || []}
            selectedRoute={route}
            destination={destination}
            telemetry={frame}
            navigating={navigating}
            satellite={satellite}
            category={category}
            onSelect={selectPlace}
            onPick={selectPoint}
            onFollow={setFollow}
            follow={follow}
            onReady={() => setMapReady(true)}
            recoveryTarget={recovery.target}
          />
        )}
        {(!data || !mapReady) && (
          <div className="map-loading">
            <LoaderCircle className="spin" />
            <span>正在载入 Brio 地图</span>
            <small>道路、地标与导航数据</small>
          </div>
        )}
        <aside
          className={`side-panel ${navigating ? "navigation-panel" : ""}`}
          aria-label={navigating ? "导航信息" : "搜索与路线规划"}
        >
          {navigating && route && nextStep ? (
            <>
              <div
                className={`turn-card ${recovery.status !== "normal" ? "recovering" : ""}`}
              >
                <div className="turn-topline">
                  <span>
                    <span className="status-dot" />
                    {recovery.status === "normal"
                      ? "正在导航"
                      : recovery.status === "deviated"
                        ? "已偏离路线"
                        : recovery.status === "rerouting"
                          ? "正在重新规划"
                          : recovery.status === "error"
                            ? "重新规划暂不可用"
                            : "返回道路指引"}
                  </span>
                  <button
                    className="light-icon"
                    onClick={() =>
                      updateSettings({ ...settings, voice: !settings.voice })
                    }
                    aria-label={
                      settings.voice ? "关闭语音播报" : "打开语音播报"
                    }
                  >
                    {settings.voice ? (
                      <Volume2 size={19} />
                    ) : (
                      <VolumeX size={19} />
                    )}
                  </button>
                </div>
                <div className="turn-main">
                  {recovery.status === "off-road" ||
                  recovery.status === "returning" ? (
                    <Navigation2
                      size={57}
                      style={{ transform: `rotate(${frame.heading}deg)` }}
                    />
                  ) : recovery.status === "deviated" ||
                    recovery.status === "rerouting" ? (
                    <LoaderCircle className="spin" size={50} />
                  ) : (
                    <TurnIcon kind={nextStep.kind} size={64} />
                  )}
                  <div>
                    {recovery.status !== "normal" ? (
                      <>
                        <div className="turn-distance recovery-distance">
                          {recovery.target ? (
                            <>
                              {distance(recovery.distance).replace(
                                /公里|米/g,
                                "",
                              )}
                              <span>
                                {recovery.distance >= 1000 ? "公里" : "米"}
                              </span>
                            </>
                          ) : (
                            <span>
                              {recovery.status === "error"
                                ? "请重试"
                                : "路线更新中"}
                            </span>
                          )}
                        </div>
                        <p>
                          {recovery.target
                            ? "朝指引方向返回道路"
                            : recovery.status === "error"
                              ? "保留目的地，等待重试"
                              : "按当前车位重新规划"}
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="turn-distance">
                          {distance(
                            Math.max(0, nextStep.at - frame.progress),
                          ).replace(/公里|米/g, "")}
                          <span>
                            {nextStep.at - frame.progress >= 1000
                              ? "公里"
                              : "米"}
                          </span>
                        </div>
                        <p>{nextStep.text}</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="turn-next">
                  <span>随后</span>
                  <TurnIcon
                    kind={
                      recoveryBlocked
                        ? "straight"
                        : route.steps[route.steps.indexOf(nextStep) + 1]
                            ?.kind || "arrive"
                    }
                    size={17}
                  />
                  <span>
                    {recoveryBlocked
                      ? "回到道路后恢复导航"
                      : route.steps[route.steps.indexOf(nextStep) + 1]?.text ||
                        "到达目的地附近"}
                  </span>
                </div>
              </div>
              <div className="driving-info">
                {recovery.status !== "normal" && (
                  <div className="recovery-notice" role="status">
                    <strong>
                      {recovery.status === "off-road" ||
                      recovery.status === "returning"
                        ? "你已驶离道路"
                        : recovery.status === "error"
                          ? "暂时无法更新路线"
                          : "检测到偏航，正在更新路线"}
                    </strong>
                    <p>
                      {recovery.target
                        ? "虚线为最近道路方向，请避开地形障碍。回到道路后自动恢复导航。"
                        : recovery.error ||
                          "目的地保持不变，请留意新的转向提示。"}
                    </p>
                    {recovery.status === "off-road" && (
                      <button
                        className="recovery-action"
                        onClick={recovery.returnToRoad}
                      >
                        <Navigation size={15} />
                        模拟返回道路
                      </button>
                    )}
                    {recovery.status === "returning" && (
                      <span>正在驶回道路…</span>
                    )}
                    {recovery.status === "error" && (
                      <button
                        className="recovery-action"
                        onClick={recovery.retry}
                      >
                        重试算路
                      </button>
                    )}
                  </div>
                )}
                <div className="drive-destination">
                  <span className="endpoint-inline">终</span>
                  <div>
                    <strong>{destination?.name}</strong>
                    <span>
                      {destination?.region} ·{" "}
                      {labelCategory(destination?.category || "")}
                    </span>
                  </div>
                </div>
                <div className="drive-stats">
                  <div>
                    <strong>
                      {Math.round(frame.speedKmh)}
                      <small>km/h</small>
                    </strong>
                    <span>当前车速</span>
                  </div>
                  <div>
                    <strong>
                      {frame.gear || "N"}
                      <small>挡</small>
                    </strong>
                    <span>模拟挡位</span>
                  </div>
                  <div>
                    <strong>
                      {Math.round(frame.position[2] || 0)}
                      <small>m</small>
                    </strong>
                    <span>道路海拔</span>
                  </div>
                </div>
                <div className="trip-progress">
                  <span
                    style={{
                      width: `${(100 * frame.progress) / route.distance}%`,
                    }}
                  />
                </div>
                <div className="trip-progress-caption">
                  <span>已行驶 {distance(frame.progress)}</span>
                  <span>
                    {Math.min(
                      100,
                      Math.round((frame.progress / route.distance) * 100),
                    )}
                    %
                  </span>
                </div>
                <button
                  className="row-button"
                  onClick={() => setStepsOpen((s) => !s)}
                >
                  <RouteIcon size={17} />
                  <span>路线详情</span>
                  <ChevronDown
                    size={16}
                    className={stepsOpen ? "rotate" : ""}
                  />
                </button>
                {stepsOpen && (
                  <ol className="steps-list">
                    {route.steps
                      .filter((s) => s.at >= frame.progress)
                      .map((s) => (
                        <li key={s.index}>
                          <TurnIcon kind={s.kind} size={18} />
                          <div>
                            <strong>{s.text}</strong>
                            <span>{distance(s.at - frame.progress)}后</span>
                          </div>
                        </li>
                      ))}
                  </ol>
                )}
              </div>
              <div className="playback-bar">
                <Radio size={16} />
                <button
                  className="scenario-toggle"
                  aria-expanded={scenariosOpen}
                  onClick={() => setScenariosOpen((v) => !v)}
                >
                  模拟驾驶 · {settings.rate}×<ChevronDown size={13} />
                </button>
                <button
                  onClick={() => setPaused(!paused)}
                  aria-label={paused ? "继续模拟行驶" : "暂停模拟行驶"}
                >
                  {paused ? <Play size={17} /> : <Pause size={17} />}
                  <span>{paused ? "继续" : "暂停"}</span>
                </button>
                <button
                  className="icon-button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="设置模拟速度"
                >
                  <SlidersHorizontal size={17} />
                </button>
              </div>
              {scenariosOpen && (
                <div className="scenario-panel">
                  <span>模拟驾驶场景</span>
                  <button
                    disabled={
                      recovery.status !== "normal" || recovery.eventBusy
                    }
                    onClick={() => {
                      setScenariosOpen(false);
                      void recovery.simulate("road");
                    }}
                  >
                    <RouteIcon size={16} />
                    <div>
                      <strong>偏离原路线</strong>
                      <small>驶入另一条道路，自动重新算路</small>
                    </div>
                    <ChevronRight size={15} />
                  </button>
                  <button
                    disabled={
                      recovery.status !== "normal" || recovery.eventBusy
                    }
                    onClick={() => {
                      setScenariosOpen(false);
                      void recovery.simulate("terrain");
                    }}
                  >
                    <Mountain size={16} />
                    <div>
                      <strong>驶出道路</strong>
                      <small>进入非道路区域，指引返回路网</small>
                    </div>
                    <ChevronRight size={15} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="search-area">
                <div className="search-box">
                  <Search size={21} />
                  <input
                    ref={search}
                    aria-label={pickingOrigin ? "搜索起点" : "搜索地点"}
                    placeholder={
                      pickingOrigin
                        ? "搜索起点或在地图上选择"
                        : "搜索地点、赛道、风景地标"
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query ? (
                    <button
                      aria-label="清空搜索"
                      className="clear-search"
                      onClick={() => setQuery("")}
                    >
                      <X size={16} />
                    </button>
                  ) : (
                    <kbd>⌘ K</kbd>
                  )}
                </div>
                {pickingOrigin ? (
                  <div className="origin-hint">
                    <span>选择起点，也可直接点击地图</span>
                    <button
                      onClick={() => {
                        setPickingOrigin(false);
                        setQuery("");
                      }}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  browseContent && (
                    <div className="category-tabs">
                      {categories.map(({ id, name, icon: Icon }) => (
                        <button
                          key={id}
                          className={category === id ? "active" : ""}
                          onClick={() => setCategory(id)}
                        >
                          <Icon size={16} />
                          {name}
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
              {browseContent ? (
                <>
                  <div className="browse-scroll">
                    {!query && !pickingOrigin && (
                      <>
                        <div className="browse-tabs">
                          <button
                            onClick={() => setTab("explore")}
                            className={tab === "explore" ? "active" : ""}
                          >
                            附近推荐
                          </button>
                          <button
                            onClick={() => setTab("saved")}
                            className={tab === "saved" ? "active" : ""}
                          >
                            我的收藏
                            {favorites.length > 0 && (
                              <span>{favorites.length}</span>
                            )}
                          </button>
                        </div>
                        {tab === "explore" && category === "all" && (
                          <div className="explore-title">
                            <div>
                              <span className="eyebrow">
                                出发，去发现新的风景
                              </span>
                              <h1>探索东京与周边</h1>
                              <p>从城市街道，到山海之间。</p>
                            </div>
                            <Compass size={48} strokeWidth={1.1} />
                          </div>
                        )}
                        {recent.length > 0 &&
                          tab === "explore" &&
                          category === "all" && (
                            <div className="recent">
                              <span>
                                <Clock size={13} />
                                最近搜索
                              </span>
                              <div>
                                {recent.map((p) => (
                                  <button
                                    key={p.id}
                                    onClick={() => selectPlace(p)}
                                  >
                                    {p.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                      </>
                    )}
                    <div className="list-caption">
                      <span>
                        {query
                          ? `搜索结果 · ${visiblePlaces.length}`
                          : pickingOrigin
                            ? "选择出发地点"
                            : tab === "saved"
                              ? "已收藏的地点"
                              : category === "all"
                                ? "值得一去"
                                : categories.find((c) => c.id === category)
                                    ?.name}
                      </span>
                      <small>
                        {query ? "支持中英文地名" : "按直线距离排序"}
                      </small>
                    </div>
                    <div className="places-list">
                      {visiblePlaces
                        .slice(
                          0,
                          query || tab === "saved" || category !== "all"
                            ? 74
                            : 8,
                        )
                        .map((p) => (
                          <div className="place-row" key={p.id}>
                            <button
                              className="place-select"
                              onClick={() => selectPlace(p)}
                            >
                              <PlaceIcon category={p.category} />
                              <div className="place-copy">
                                <strong>{p.name}</strong>
                                <span>
                                  {p.region}
                                  <i /> {labelCategory(p.category)}
                                </span>
                              </div>
                              <div className="place-distance">
                                {distance(
                                  Math.hypot(
                                    p.position[0] - origin.position[0],
                                    p.position[1] - origin.position[1],
                                  ),
                                )
                                  .replace("公里", " km")
                                  .replace("米", " m")}
                                <ChevronRight size={14} />
                              </div>
                            </button>
                            {tab === "saved" && (
                              <button
                                className="remove-saved"
                                onClick={() => toggleFavorite(p)}
                                aria-label={`取消收藏${p.name}`}
                              >
                                <Heart size={15} fill="currentColor" />
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                    {!visiblePlaces.length && (
                      <div className="empty-state">
                        {tab === "saved" ? (
                          <Heart size={30} />
                        ) : (
                          <Search size={30} />
                        )}
                        <h3>
                          {tab === "saved" && !query
                            ? "还没有收藏地点"
                            : "没有找到匹配地点"}
                        </h3>
                        <p>
                          {tab === "saved" && !query
                            ? "选择一个地点，点击收藏，下次更快出发。"
                            : "试试“东京”“机场”或英文地名。"}
                        </p>
                        {query && (
                          <button
                            className="text-button"
                            onClick={() => setQuery("")}
                          >
                            清空搜索
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="location-card">
                    <span className="location-icon">
                      <LocateFixed size={22} />
                    </span>
                    <div>
                      <strong>
                        {origin.name === "我的位置"
                          ? `当前位置 · ${origin.region}`
                          : origin.name}
                      </strong>
                      <span>模拟定位 · {origin.en.split(" · ")[0]}</span>
                    </div>
                    <button
                      aria-label="定位到当前位置"
                      className="icon-button"
                      onClick={() => map.current?.locate()}
                    >
                      <Navigation size={19} />
                    </button>
                  </div>
                  <div className="panel-foot">
                    <span>
                      <ShieldCheck size={13} />
                      本地地图已载入
                    </span>
                    <span>74 地点 · 10 地区</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="route-scroll">
                    <div className="route-heading">
                      <button
                        className="icon-button"
                        onClick={back}
                        aria-label="返回地图浏览"
                      >
                        <ArrowLeft size={20} />
                      </button>
                      <h2>{mode === "arrived" ? "行程完成" : "驾车路线"}</h2>
                      <button
                        className={`icon-button ${destination && favorites.includes(destination.id) ? "is-saved" : ""}`}
                        onClick={() =>
                          destination && toggleFavorite(destination)
                        }
                        aria-label={
                          destination && favorites.includes(destination.id)
                            ? "取消收藏目的地"
                            : "收藏目的地"
                        }
                      >
                        <Star
                          size={19}
                          fill={
                            destination && favorites.includes(destination.id)
                              ? "currentColor"
                              : "none"
                          }
                        />
                      </button>
                    </div>
                    <div className="route-endpoints">
                      <div className="endpoint-dots">
                        <span />
                        <i />
                        <span />
                      </div>
                      <div className="endpoints-fields">
                        <button
                          onClick={() => {
                            setPickingOrigin(true);
                            setQuery("");
                            setTab("explore");
                            setCategory("all");
                            setTimeout(() => search.current?.focus(), 0);
                          }}
                        >
                          <span>{origin.name}</span>
                          <small>更换起点</small>
                        </button>
                        <div>
                          <span>{destination?.name}</span>
                          <small>{destination?.region}</small>
                        </div>
                      </div>
                      <button
                        className="icon-button swap"
                        aria-label="交换起点终点"
                        onClick={() => {
                          if (destination) {
                            setOrigin(destination);
                            setDestination(origin);
                            setMode("routes");
                          }
                        }}
                      >
                        <ArrowDownUp size={19} />
                      </button>
                    </div>
                    <div className="travel-mode">
                      <span>
                        <CarFront size={16} />
                        驾车
                      </span>
                      <p>路线方案</p>
                      <span className="route-count">
                        {plan ? `${plan.routes.length} 条路线` : "正在规划"}
                      </span>
                    </div>
                    {calculating ? (
                      <div className="route-loading">
                        <LoaderCircle className="spin" size={25} />
                        <strong>正在规划路线</strong>
                        <span>沿可通行道路寻找合适路径</span>
                      </div>
                    ) : routeError ? (
                      <div className="empty-state route-error">
                        <RouteIcon size={30} />
                        <h3>暂时无法规划路线</h3>
                        <p>{routeError}</p>
                        <button
                          className="secondary"
                          onClick={() => setRevision((v) => v + 1)}
                        >
                          重新计算
                        </button>
                      </div>
                    ) : plan && route ? (
                      <>
                        {mode === "arrived" && (
                          <div className="arrived-card">
                            <CheckCircle2 size={34} />
                            <div>
                              <h3>已到达目的地附近</h3>
                              <p>本次行驶 {distance(route.distance)}</p>
                            </div>
                          </div>
                        )}
                        <div className="route-options">
                          {plan.routes.map((r) => (
                            <button
                              key={r.id}
                              aria-pressed={route.id === r.id}
                              className={`route-option ${route.id === r.id ? "active" : ""}`}
                              onClick={() => {
                                setRouteId(r.id);
                                setMode("routes");
                              }}
                            >
                              <div className="route-option-top">
                                <strong>{r.label}</strong>
                              </div>
                              <div className="route-numbers">
                                <b>{time(r.duration)}</b>
                                <span>{distance(r.distance)}</span>
                              </div>
                              <p>
                                {r.highway > 200
                                  ? `高速 ${distance(r.highway)}`
                                  : "无高速路段"}
                                <i />
                                {r.unpaved > 80
                                  ? `非铺装 ${distance(r.unpaved)}`
                                  : "以铺装道路为主"}
                              </p>
                            </button>
                          ))}
                        </div>
                        <div className="selected-route-summary">
                          <span>
                            {route.unpaved > 80
                              ? `非铺装 ${distance(route.unpaved)}`
                              : "全程以铺装道路为主"}
                          </span>
                          <span>
                            {route.highway > 200
                              ? `高速 ${distance(route.highway)}`
                              : "无高速路段"}
                          </span>
                        </div>
                        <div className="route-note">
                          <ShieldCheck size={15} />
                          <span>已考虑单行道 · 时间按道路类型估算</span>
                        </div>
                        {plan.snap.to > 60 && (
                          <div className="snap-note">
                            <MapPin size={15} />
                            <span>
                              导航至目的地附近道路，距地标约{" "}
                              {distance(plan.snap.to)}。
                            </span>
                          </div>
                        )}
                        <button
                          className="row-button detail-toggle"
                          onClick={() => setStepsOpen((v) => !v)}
                        >
                          <RouteIcon size={17} />
                          <span>查看路线详情</span>
                          <small>{route.steps.length - 1} 个指引</small>
                          <ChevronDown
                            size={16}
                            className={stepsOpen ? "rotate" : ""}
                          />
                        </button>
                        {stepsOpen && (
                          <ol className="steps-list">
                            {route.steps.map((s) => (
                              <li key={s.index}>
                                <TurnIcon kind={s.kind} size={18} />
                                <div>
                                  <strong>{s.text}</strong>
                                  <span>距起点 {distance(s.at)}</span>
                                </div>
                              </li>
                            ))}
                          </ol>
                        )}
                      </>
                    ) : null}
                  </div>
                  <div className="route-actions">
                    <div className="departure">
                      <Clock size={14} />
                      <span>现在出发</span>
                      <span>
                        {route ? `${arrival(route.duration)} 到达` : ""}
                      </span>
                    </div>
                    <button
                      className="primary start-button"
                      disabled={!route || calculating}
                      onClick={start}
                    >
                      <Navigation size={20} fill="currentColor" />
                      {mode === "arrived" ? "重新导航" : "开始导航"}
                      <span>模拟驾驶</span>
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </aside>
        <div className="map-controls">
          <button
            aria-label="地图朝北"
            title="朝北查看 · 暂停跟随"
            className="compass-button"
            onClick={() => map.current?.north()}
          >
            <span>N</span>
            <Navigation2 size={24} fill="#e46f6c" />
          </button>
          <div className="control-group">
            <button
              aria-label="放大地图"
              title="放大"
              onClick={() => map.current?.zoom(0.5)}
            >
              <Plus size={21} />
            </button>
            <button
              aria-label="缩小地图"
              title="缩小"
              onClick={() => map.current?.zoom(-0.5)}
            >
              <Minus size={21} />
            </button>
          </div>
          <button
            aria-label="查看全览"
            title="全览"
            onClick={() => map.current?.overview()}
          >
            <Maximize size={20} />
            <small>全览</small>
          </button>
          <button
            aria-label="回到车辆位置"
            title={follow ? "正在跟随车辆" : "恢复车头朝上跟随"}
            className={follow ? "active" : ""}
            onClick={() => map.current?.locate()}
          >
            <LocateFixed size={22} />
          </button>
          <button
            aria-label="切换地图图层"
            title="图层"
            className={layersOpen ? "active" : ""}
            onClick={() => setLayersOpen((v) => !v)}
          >
            <Layers size={21} />
          </button>
          <button
            aria-label="模拟遥测与驾驶设置"
            title="驾驶设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={20} />
          </button>
        </div>
        {layersOpen && (
          <div className="layers-popover">
            <h3>地图图层</h3>
            <div>
              {[
                { id: false, name: "标准地图", file: "standard" },
                { id: true, name: "卫星地图", file: "satellite" },
              ].map((l) => (
                <button
                  key={l.file}
                  className={satellite === l.id ? "selected" : ""}
                  onClick={() => {
                    setSatellite(l.id);
                    setLayersOpen(false);
                  }}
                >
                  <img src={`/maps/${l.file}.webp`} alt="" />
                  <span>
                    {l.name}
                    {satellite === l.id && <Check size={14} />}
                  </span>
                </button>
              ))}
            </div>
            <p>两种图层均支持搜索与路线导航</p>
          </div>
        )}
        {navigating && route && (
          <div className="navigation-dock">
            <button
              className="exit-navigation"
              onClick={stop}
              aria-label="退出导航"
            >
              <X size={23} />
              <span>退出</span>
            </button>
            <div className="eta">
              <div>
                <strong>{distance(remaining)}</strong>
                <b>{time(remainingTime)}</b>
              </div>
              <span>
                {recoveryBlocked
                  ? "返回道路后更新到达时间"
                  : `${arrival(remainingTime)} 到达 · ${paused ? "行驶已暂停" : "模拟行驶中"}`}
              </span>
            </div>
            <button
              className="dock-overview"
              onClick={() => map.current?.overview()}
            >
              <MapIcon size={23} />
              <span>全览</span>
            </button>
          </div>
        )}
        {!navigating && (
          <div className="map-bottom-note">
            <span className="map-wordmark">
              <Navigation2 size={17} fill="currentColor" />
              HORIZON NAV
            </span>
            <span>Brio · 游戏地图</span>
            <i />
            <span>点击地图选择目的地</span>
          </div>
        )}
        {toast && (
          <div className="toast" role="status">
            <Check size={16} />
            {toast}
          </div>
        )}
      </main>
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onReset={() => {
            setSettings(defaultSettings);
            setToast("已恢复默认驾驶设置");
          }}
        />
      )}
    </div>
  );
}
