import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeHorizonPacket } from "../server/telemetry-contract.mjs";
test("Horizon Data Out reserved adapter converts X/Y/Z to map X/Z/Y and m/s to km/h", () => {
  const b = Buffer.alloc(324);
  b.writeInt32LE(1, 0);
  b.writeUInt32LE(1234, 4);
  b.writeFloatLE(3000, 16);
  b.writeFloatLE(Math.PI / 2, 56);
  b.writeFloatLE(-1500, 244);
  b.writeFloatLE(120, 248);
  b.writeFloatLE(-4000, 252);
  b.writeFloatLE(25, 256);
  b.writeUInt8(3, 319);
  const t = decodeHorizonPacket(b);
  assert.deepEqual(t.position, [-1500, -4000, 120]);
  assert.equal(t.speedKmh, 90);
  assert.ok(Math.abs(t.heading - 90) < 0.001);
  assert.equal(t.connected, true);
  assert.equal(t.gear, 3);
});
test("unknown packet lengths and non-finite coordinates are rejected", () => {
  assert.throws(() => decodeHorizonPacket(Buffer.alloc(311)), /size/);
  const b = Buffer.alloc(323);
  b.writeFloatLE(NaN, 244);
  assert.throws(() => decodeHorizonPacket(b), /Invalid/);
});
