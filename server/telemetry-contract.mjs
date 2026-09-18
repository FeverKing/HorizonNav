/** Reserved adapter; not connected to a UDP listener. See docs/TELEMETRY.md.
 * Layout verified against the pinned community Horizon Data Out specification,
 * NOT against a live FH6 packet. Unknown sizes fail closed, rather than misplacing the car.
 */
export function decodeHorizonPacket(
  buffer,
  { headingSign = 1, headingOffset = 0 } = {},
) {
  if (!Buffer.isBuffer(buffer) || ![323, 324].includes(buffer.length))
    throw new Error(
      "Unsupported Horizon packet size; expected 323 or 324 bytes",
    );
  const x = buffer.readFloatLE(244),
    y = buffer.readFloatLE(248),
    z = buffer.readFloatLE(252),
    speed = buffer.readFloatLE(256),
    yaw = buffer.readFloatLE(56),
    rpm = buffer.readFloatLE(16);
  if (
    ![x, y, z, speed, yaw, rpm].every(Number.isFinite) ||
    speed < 0 ||
    speed > 250 ||
    Math.abs(x) > 50000 ||
    Math.abs(z) > 50000
  )
    throw new Error("Invalid telemetry values");
  return {
    source: "udp",
    connected: buffer.readInt32LE(0) === 1,
    timestamp: Date.now(),
    gameTimestamp: buffer.readUInt32LE(4),
    position: [x, z, y],
    heading:
      (((((yaw * 180) / Math.PI) * headingSign + headingOffset) % 360) + 360) %
      360,
    speedKmh: speed * 3.6,
    rpm,
    gear: buffer.readUInt8(319),
  };
}
