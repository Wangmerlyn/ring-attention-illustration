import test from 'node:test'
import assert from 'node:assert/strict'
import { createMergeTrace, demoBlocks, demoReference } from '../src/onlineSoftmaxDemo.js'
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} differs from ${b}`)

test('each partial O equals ordinary attention over exactly the blocks seen so far', () => {
  const trace = createMergeTrace()
  trace.forEach((item, i) => {
    const seen = demoBlocks.slice(0, i + 1)
    close(item.after.o, demoReference(seen).output)
    close(item.after.z, seen.flatMap(b => b.scores).reduce((sum, s) => sum + Math.exp(s), 0))
    close(item.probabilities.reduce((sum, p) => sum + p, 0), 1)
  })
  close(trace[0].after.o, trace[0].local.o)
})

test('partial outputs combine using their denominators, not a sum or an unweighted average', () => {
  const trace = createMergeTrace()
  trace.forEach(item => {
    close(item.oldShare + item.newShare, 1)
    close(item.after.o, (item.before.z * item.before.o + item.local.z * item.local.o) / item.after.z)
    close(item.local.o, item.weights.reduce((sum, weight, i) => sum + weight * item.block.values[i], 0) / item.local.z)
  })
  const second = trace[1]
  assert.ok(Math.abs(second.oldShare - .5) > .1)
  assert.ok(Math.abs(second.after.o - (second.before.o + second.local.o) / 2) > .1)
  assert.ok(Math.abs(second.after.o - second.before.o - second.local.o) > 1)
})

test('final incremental O agrees with independent full attention', () => {
  const trace = createMergeTrace()
  const reference = demoReference()
  close(reference.probabilities.reduce((sum, p) => sum + p, 0), 1)
  close(trace.at(-1).after.o, reference.output)
  assert.ok(Math.abs(trace[0].after.o - reference.output) > 1)
})
