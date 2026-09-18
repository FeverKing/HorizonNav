import "leaflet";
declare module "leaflet" {
  interface MapOptions {
    rotate?: boolean;
    bearing?: number;
    touchRotate?: boolean;
    rotateControl?: boolean;
    shiftKeyRotate?: boolean;
  }
  interface Map {
    setBearing(degrees: number): void;
    getBearing(): number;
  }
  interface MarkerOptions {
    rotateWithView?: boolean;
  }
}
declare module "leaflet-rotate";
