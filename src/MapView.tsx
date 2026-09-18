import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import L from "leaflet";
import "leaflet-rotate";
import { sampleRoute } from "./telemetry";
import type { Place, Position, Region, Route, Telemetry } from "./types";
export interface MapControls {
  zoom: (delta: number) => void;
  north: () => void;
  locate: () => void;
  overview: () => void;
  flyTo: (position: Position) => void;
}
interface Props {
  places: Place[];
  regions: Region[];
  roads: GeoJSON.FeatureCollection;
  routes: Route[];
  selectedRoute?: Route;
  destination: Place | null;
  telemetry: Telemetry;
  navigating: boolean;
  satellite: boolean;
  category: string;
  onSelect: (p: Place) => void;
  onPick: (p: Position) => void;
  onFollow: (b: boolean) => void;
  follow: boolean;
  onReady: () => void;
  recoveryTarget: Position | null;
}
const bounds: L.LatLngBoundsExpression = [
  [-11275.139, -12541.169],
  [10741.928, 9481.274],
];
const arrowSvg =
  '<svg viewBox="0 0 44 54" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L39 45 22 36 5 45Z" fill="#287bf2" stroke="white" stroke-width="3" stroke-linejoin="round"/><path d="M22 8V34L9 41Z" fill="#78b8ff"/></svg>';
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export default forwardRef<MapControls, Props>(function MapView(props, ref) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    latest = useRef(props),
    roadLayer = useRef<L.GeoJSON | null>(null),
    image = useRef<L.ImageOverlay | null>(null),
    vehicle = useRef<L.Marker | null>(null),
    routeLayer = useRef<L.LayerGroup | null>(null),
    labels = useRef<L.LayerGroup | null>(null),
    recoveryLayer = useRef<L.LayerGroup | null>(null),
    travelled = useRef<L.Polyline | null>(null),
    cameraUpdate = useRef(false),
    manual = useRef(false),
    [ready, setReady] = useState(false);
  latest.current = props;
  const pad = () => {
    const root = el.current?.closest(".workspace");
    const size = map.current?.getSize() ?? L.point(innerWidth, innerHeight);
    const panel = root?.querySelector(".side-panel")?.getBoundingClientRect();
    if (root instanceof HTMLElement && panel)
      root.style.setProperty("--route-panel-height", `${size.y - panel.top}px`);
    const header = root
      ?.querySelector(".route-endpoints")
      ?.getBoundingClientRect();
    if (size.x > 760)
      return {
        paddingTopLeft: L.point((panel?.right ?? 400) + 36, 55),
        paddingBottomRight: L.point(85, 110),
      };
    return {
      paddingTopLeft: L.point(36, (header?.bottom ?? 110) + 42),
      paddingBottomRight: L.point(
        65,
        size.y - (panel?.top ?? size.y * 0.55) + 40,
      ),
    };
  };
  const followVehicle = () => {
    const m = map.current,
      p = latest.current;
    if (!m || !p.navigating || !p.follow || manual.current) return;
    cameraUpdate.current = true;
    m.setBearing(-p.telemetry.heading);
    const size = m.getSize();
    const anchor = L.point(size.x * (size.x > 760 ? 0.59 : 0.5), size.y * 0.7);
    const offset = anchor.subtract(size.divideBy(2));
    const angle = (-m.getBearing() * Math.PI) / 180;
    const worldOffset = L.point(
      offset.x * Math.cos(angle) - offset.y * Math.sin(angle),
      offset.x * Math.sin(angle) + offset.y * Math.cos(angle),
    );
    const position = m.project(
      [p.telemetry.position[1], p.telemetry.position[0]],
      m.getZoom(),
    );
    m.setView(
      m.unproject(position.subtract(worldOffset), m.getZoom()),
      m.getZoom(),
      { animate: false },
    );
    cameraUpdate.current = false;
  };
  const overview = () => {
    const m = map.current,
      p = latest.current;
    if (!m) return;
    manual.current = true;
    p.onFollow(false);
    m.setBearing(0);
    m.setMaxBounds([
      [-100000, -100000],
      [100000, 100000],
    ]);
    m.setMinZoom(-6);
    if (p.selectedRoute)
      m.fitBounds(
        p.selectedRoute.points.map((pt) => [pt[1], pt[0]]),
        { ...pad(), maxZoom: -1.6, animate: true },
      );
    else
      m.fitBounds(
        [
          [-8500, -7600],
          [9000, 6500],
        ],
        { ...pad(), animate: true },
      );
    p.onFollow(false);
  };
  useImperativeHandle(
    ref,
    () => ({
      north: () => {
        manual.current = true;
        latest.current.onFollow(false);
        map.current?.setBearing(0);
      },
      zoom: (d) => map.current?.setZoom((map.current?.getZoom() ?? -3) + d),
      locate: () => {
        const p = latest.current,
          t = p.telemetry.position;
        manual.current = false;
        map.current?.setView([t[1], t[0]], p.navigating ? -1.2 : -1.8, {
          animate: false,
        });
        p.onFollow(true);
        requestAnimationFrame(followVehicle);
      },
      overview,
      flyTo: (p) => {
        map.current?.setView([p[1], p[0]], -1.7, { animate: true });
        latest.current.onFollow(false);
      },
    }),
    [],
  );
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      rotate: true,
      touchRotate: true,
      rotateControl: false,
      shiftKeyRotate: true,
      minZoom: -5.2,
      maxZoom: 0.4,
      zoomSnap: 0.1,
      zoomDelta: 0.5,
      preferCanvas: true,
      maxBounds: [
        [-16000, -17500],
        [15500, 14500],
      ],
      maxBoundsViscosity: 1,
    });
    map.current = m;
    image.current = L.imageOverlay("/maps/standard.webp", bounds, {
      opacity: 1,
    }).addTo(m);
    const origin = latest.current.telemetry.position;
    m.setView([origin[1], origin[0]], -1.8, { animate: false });
    L.control
      .scale({
        position: "bottomleft",
        imperial: false,
        metric: true,
        maxWidth: 110,
      })
      .addTo(m);
    let scaleTimer: ReturnType<typeof setTimeout> | undefined;
    m.on("zoomstart", () => {
      clearTimeout(scaleTimer);
      el.current?.classList.add("show-scale");
    });
    m.on("zoomend", () => {
      clearTimeout(scaleTimer);
      scaleTimer = setTimeout(
        () => el.current?.classList.remove("show-scale"),
        1200,
      );
    });
    // Keep the rotated viewport inside the raster even when zooming out.
    const constrainViewport = () => {
      if (latest.current.selectedRoute && !latest.current.navigating) return;
      const size = m.getSize(),
        angle = (m.getBearing() * Math.PI) / 180;
      const c = Math.abs(Math.cos(angle)),
        s = Math.abs(Math.sin(angle));
      const width = size.x * c + size.y * s;
      const height = size.x * s + size.y * c;
      const minZoom =
        Math.ceil(
          Math.log2(Math.max(width / 22022.443, height / 22017.067)) * 10,
        ) / 10;
      if (m.getMinZoom() !== minZoom) m.setMinZoom(minZoom);
    };
    constrainViewport();
    m.on("resize rotate", constrainViewport);
    routeLayer.current = L.layerGroup().addTo(m);
    recoveryLayer.current = L.layerGroup().addTo(m);
    labels.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) =>
      latest.current.onPick([e.latlng.lng, e.latlng.lat]),
    );
    const stopFollow = () => {
      manual.current = true;
      latest.current.onFollow(false);
    };
    m.on("dragstart", stopFollow);
    m.on("rotate", () => {
      if (!cameraUpdate.current) stopFollow();
      const arrow = vehicle.current
        ?.getElement()
        ?.querySelector<HTMLElement>(".navigation-arrow");
      if (arrow)
        arrow.style.transform = `rotate(${latest.current.telemetry.heading + m.getBearing()}deg)`;
      el.current?.style.setProperty("--bearing", `${m.getBearing()}deg`);
      document
        .querySelector<HTMLElement>(".compass-button svg")
        ?.style.setProperty("transform", `rotate(${m.getBearing()}deg)`);
    });
    m.on("resize", followVehicle);
    const observer = new ResizeObserver(() => m.invalidateSize({ pan: false }));
    observer.observe(el.current);
    setReady(true);
    latest.current.onReady();
    return () => {
      clearTimeout(scaleTimer);
      observer.disconnect();
      m.remove();
      map.current = null;
      setReady(false);
    };
  }, []);
  useEffect(() => {
    if (!ready || !map.current) return;
    image.current?.setUrl(
      `/maps/${props.satellite ? "satellite" : "standard"}.webp`,
    );
  }, [props.satellite, ready]);
  useEffect(() => {
    if (!ready || !map.current) return;
    roadLayer.current?.remove();
    const m = map.current,
      renderer = L.canvas({ padding: 0.5 });
    roadLayer.current = L.geoJSON(props.roads, {
      coordsToLatLng: (c) => L.latLng(c[1], c[0]),
      style: (f) => {
        const t = f?.properties?.road_type;
        return {
          renderer,
          color: props.satellite
            ? t === "freeway"
              ? "#ffd9a6"
              : "#f2f5ef"
            : t === "freeway"
              ? "#e6be82"
              : t === "dirt" || t === "trail"
                ? "#c8b491"
                : t === "shortcut"
                  ? "#90c8af"
                  : "#fff",
          weight: t === "freeway" ? 4 : t === "a" ? 3.4 : t === "b" ? 2.5 : 1.4,
          opacity: props.satellite ? 0.7 : 0.98,
          dashArray: t === "trail" ? "2 5" : t === "dirt" ? "5 3" : undefined,
          interactive: false,
        };
      },
    }).addTo(m);
    roadLayer.current.bringToBack();
    return () => {
      roadLayer.current?.remove();
    };
  }, [ready, props.roads, props.satellite]);
  useEffect(() => {
    if (!ready || !map.current || !labels.current) return;
    const m = map.current,
      group = labels.current;
    const update = () => {
      group.clearLayers();
      const occupied: L.Point[] = [];
      const selected = latest.current.destination;
      props.regions.forEach((r) => {
        if (m.getZoom() > -2.7) return;
        L.marker([r.centroid_z, r.centroid_x], {
          interactive: false,
          icon: L.divIcon({
            className: "region-label",
            html: esc(r.name),
            iconSize: [100, 25],
            iconAnchor: [50, 12],
          }),
        }).addTo(group);
      });
      const filtered = props.places.filter(
        (p) =>
          m.getBounds().pad(0.08).contains([p.position[1], p.position[0]]) &&
          (props.category === "all" ||
            p.category === props.category ||
            p.id === selected?.id),
      );
      filtered.sort(
        (a, b) => Number(b.id === selected?.id) - Number(a.id === selected?.id),
      );
      for (const p of filtered) {
        const pt = m.latLngToContainerPoint([p.position[1], p.position[0]]);
        if (
          p.id !== selected?.id &&
          occupied.some(
            (o) => Math.abs(o.x - pt.x) < 130 && Math.abs(o.y - pt.y) < 37,
          )
        )
          continue;
        occupied.push(pt);
        const symbol =
          p.category === "racing" ? "⚑" : p.category === "parking" ? "P" : "◈";
        L.marker([p.position[1], p.position[0]], {
          title: p.name,
          keyboard: true,
          icon: L.divIcon({
            className: `place-marker ${props.satellite ? "on-satellite" : ""} ${p.id === selected?.id ? "selected" : ""}`,
            html: `<span class="place-dot ${p.category}">${symbol}</span><span class="place-label">${esc(p.name)}</span>`,
            iconSize: [180, 28],
            iconAnchor: [10, 14],
          }),
        })
          .on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            latest.current.onSelect(p);
          })
          .addTo(group);
      }
    };
    update();
    m.on("moveend zoomend", update);
    return () => {
      m.off("moveend zoomend", update);
      group.clearLayers();
    };
  }, [
    ready,
    props.places,
    props.regions,
    props.destination,
    props.category,
    props.satellite,
  ]);
  useEffect(() => {
    if (!ready || !routeLayer.current || !map.current) return;
    const group = routeLayer.current;
    group.clearLayers();
    const routes = [
      ...props.routes.filter(
        (r) => !props.navigating && r.id !== props.selectedRoute?.id,
      ),
      ...(props.selectedRoute ? [props.selectedRoute] : []),
    ];
    for (const r of routes) {
      const active = r.id === props.selectedRoute?.id,
        color = active ? (props.navigating ? "#28b878" : "#287cf1") : "#7a9bd0",
        pts = r.points.map((p) => [p[1], p[0]] as L.LatLngTuple);
      L.polyline(pts, {
        color: active ? "#fff" : "#f1f5fd",
        weight: active ? 12 : 8,
        opacity: 1,
        interactive: false,
      }).addTo(group);
      L.polyline(pts, {
        color,
        weight: active ? 7 : 4,
        opacity: 1,
        interactive: false,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);
    }
    travelled.current = props.navigating
      ? L.polyline([], {
          color: "#a1a6ad",
          weight: 7,
          opacity: 1,
          interactive: false,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(group)
      : null;
    if (props.selectedRoute) {
      const a = props.selectedRoute.points[0],
        b = props.selectedRoute.points.at(-1)!;
      if (!props.navigating)
        L.marker([a[1], a[0]], {
          interactive: false,
          icon: L.divIcon({
            className: "endpoint start",
            html: "起",
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        }).addTo(group);
      L.marker([b[1], b[0]], {
        interactive: false,
        icon: L.divIcon({
          className: "endpoint end",
          html: "<span>终</span>",
          iconSize: [26, 26],
          iconAnchor: [13, 26],
        }),
      }).addTo(group);
    }
  }, [ready, props.routes, props.selectedRoute, props.navigating]);
  useEffect(() => {
    if (!ready || !props.selectedRoute || props.navigating) return;
    let frame = requestAnimationFrame(overview);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(overview);
    });
    const panel = el.current
      ?.closest(".workspace")
      ?.querySelector(".side-panel");
    if (panel) observer.observe(panel);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ready, props.selectedRoute, props.navigating]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const t = props.telemetry;
    if (!vehicle.current)
      vehicle.current = L.marker([t.position[1], t.position[0]], {
        interactive: false,
        icon: L.divIcon({
          className: "vehicle-marker",
          html: "",
          iconSize: [44, 54],
        }),
        zIndexOffset: props.selectedRoute && !props.navigating ? -100 : 2000,
      }).addTo(m);
    vehicle.current.setZIndexOffset(
      props.selectedRoute && !props.navigating ? -100 : 2000,
    );
    vehicle.current.setLatLng([t.position[1], t.position[0]]).setIcon(
      L.divIcon({
        className: `vehicle-marker ${props.navigating ? "driving" : ""}`,
        html: `<div class="navigation-arrow" style="transform:rotate(${t.heading + m.getBearing()}deg)">${arrowSvg}</div>`,
        iconSize: [44, 54],
        iconAnchor: [22, 27],
      }),
    );
    if (props.selectedRoute && travelled.current) {
      const r = props.selectedRoute;
      const sample = sampleRoute(r, t.progress);
      travelled.current.setLatLngs(
        [...r.points.slice(0, sample.index + 1), sample.position].map(
          (p) => [p[1], p[0]] as L.LatLngTuple,
        ),
      );
    }
    followVehicle();
  }, [ready, props.telemetry, props.navigating, props.follow]);
  useEffect(() => {
    if (ready && props.navigating) {
      manual.current = false;
      // Rotated follow camera must not compete with Leaflet's north-up bounds correction.
      map.current?.setMaxBounds(L.latLngBounds([]));
      map.current?.setZoom(-1.2, { animate: false });
      followVehicle();
    } else if (ready) map.current?.setBearing(0);
  }, [ready, props.navigating]);

  useEffect(() => {
    if (!ready || !recoveryLayer.current) return;
    const group = recoveryLayer.current;
    group.clearLayers();
    const p = props.telemetry.position,
      t = props.recoveryTarget;
    if (!t) return;
    L.polyline(
      [
        [p[1], p[0]],
        [t[1], t[0]],
      ],
      { color: "#fff", weight: 7, interactive: false },
    ).addTo(group);
    L.polyline(
      [
        [p[1], p[0]],
        [t[1], t[0]],
      ],
      { color: "#e4a336", weight: 4, dashArray: "8 9", interactive: false },
    ).addTo(group);
    L.marker([t[1], t[0]], {
      interactive: false,
      icon: L.divIcon({
        className: "return-road-marker",
        html: "<span>↗</span>返回道路",
        iconSize: [95, 28],
        iconAnchor: [12, 14],
      }),
    }).addTo(group);
  }, [ready, props.recoveryTarget, props.telemetry.position]);
  return (
    <div
      className={`map-canvas ${props.satellite ? "satellite" : ""}`}
      ref={el}
      aria-label="Brio 交互地图，拖动平移，滚轮缩放，点击选择目的地"
    />
  );
});
