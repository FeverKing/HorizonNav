export type Position = [number, number, number?];
export interface Place {
  id: string;
  name: string;
  en: string;
  position: Position;
  category: string;
  region: string;
}
export interface Step {
  at: number;
  index: number;
  kind: "straight" | "right" | "left" | "uturn" | "arrive";
  text: string;
  road: string;
}
export interface Route {
  id: string;
  label: string;
  profiles: string[];
  points: Position[];
  cumulative: number[];
  times: number[];
  distance: number;
  duration: number;
  unpaved: number;
  highway: number;
  steps: Step[];
}
export interface Plan {
  routes: Route[];
  snap: {
    from: number;
    to: number;
    fromPosition: Position;
    toPosition: Position;
  };
}
export interface Region {
  key: string;
  name: string;
  name_en: string;
  centroid_x: number;
  centroid_z: number;
}
export interface Telemetry {
  source: "mock" | "udp";
  connected: boolean;
  timestamp: number;
  position: Position;
  heading: number;
  speedKmh: number;
  rpm: number;
  gear: number;
  progress: number;
  session?: number; // Local navigation generation, guards stale frames on restart.
}
export interface Settings {
  speed: number;
  rate: number;
  voice: boolean;
}
export type Mode = "browse" | "routes" | "navigation" | "arrived";
