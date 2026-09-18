import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProgress } from '../src/liveTelemetry.ts';
import { sampleRoute } from '../src/telemetry.ts';
const route = {
 points: [[0,0,0], [100,0,10], [100,100,20]],
 cumulative: [0,120,250], times: [0,6,12], distance:250,
};
test('UDP progress projects onto segments using road lengths, including reverse movement', () => {
 assert.equal(matchProgress([50,5], route),60);
 assert.equal(matchProgress([103,50], route),185);
 assert.equal(matchProgress([25,0], route),30);
 assert.equal(matchProgress([-80,0], route),0);
 assert.equal(matchProgress([100,180], route),250);
});
test('interpolation and live progress agree at mid-segment and arrival', () => {
 for(const metres of [0,30,100,180,250]) {
  const sample=sampleRoute(route,metres);
  assert.ok(Math.abs(matchProgress(sample.position,route)-metres)<0.001);
 }
});
