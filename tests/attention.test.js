import test from 'node:test'
import assert from 'node:assert/strict'
import { accumulate, denseAttention, emptyAccumulator, makeExample, mergeBlock, ownerAtRound, partition } from '../src/attention.js'

for (const devices of [4, 6, 8]) {
  test(`${devices} devices: every Q visits every KV exactly once in ring order`, () => {
    for (let device = 0; device < devices; device++) {
      const owners = Array.from({ length: devices }, (_, r) => ownerAtRound(device, r, devices))
      assert.equal(owners[0], device)
      assert.equal(new Set(owners).size, devices)
      for (let r = 1; r < devices; r++) {
        assert.equal(owners[r], ownerAtRound((device + devices - 1) % devices, r - 1, devices))
      }
    }
  })
  for (const causal of [false, true]) {
    test(`${devices} devices, ${causal ? 'causal' : 'full'}: every output matches independent dense attention`, () => {
      const example = makeExample(devices)
      for (let device = 0; device < devices; device++) {
        for (let row = 0; row < example.tokensPerDevice; row++) {
          const online = accumulate(example, device, devices, devices, causal, row)
          const dense = denseAttention(example, device * example.tokensPerDevice + row, causal)
          assert.ok(online.l > 0)
          dense.forEach((value, d) => assert.ok(Math.abs(online.o[d] - value) < 1e-12))
        }
      }
    })
  }
  test(`${devices} devices: partitions cover the whole sequence without gaps`, () => {
    for (const length of [4096, 8192, 16384]) {
      let cursor = 0
      const sizes = []
      for (let device = 0; device < devices; device++) {
        const [start, end] = partition(length, devices, device)
        assert.equal(start, cursor)
        assert.ok(end > start)
        sizes.push(end - start)
        cursor = end
      }
      assert.equal(cursor, length)
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1)
    }
  })
}

test('online softmax rescales earlier blocks when the maximum increases', () => {
  let state = emptyAccumulator(2)
  state = mergeBlock(state, [1000, 1001], [[1, 2], [3, 4]])
  state = mergeBlock(state, [1002, 999], [[5, 6], [7, 8]])
  const scores = [1000, 1001, 1002, 999]
  const values = [[1, 2], [3, 4], [5, 6], [7, 8]]
  const weights = scores.map(score => Math.exp(score - 1002))
  for (let d = 0; d < 2; d++) {
    const expected = weights.reduce((sum, w, i) => sum + w * values[i][d], 0) / weights.reduce((a, b) => a + b, 0)
    assert.ok(Number.isFinite(state.o[d]))
    assert.ok(Math.abs(expected - state.o[d]) < 1e-12)
  }
})

test('fully masked blocks preserve both empty and populated accumulators', () => {
  const empty = emptyAccumulator(2)
  assert.deepEqual(mergeBlock(empty, [-Infinity, -Infinity], [[1, 2], [3, 4]]), empty)
  const populated = mergeBlock(empty, [2, 3], [[1, 2], [3, 4]])
  assert.deepEqual(mergeBlock(populated, [-Infinity, -Infinity], [[8, 9], [10, 11]]), populated)
})
