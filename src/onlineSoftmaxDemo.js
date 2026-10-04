// Ordinary softmax with deliberately small scores: the introductory animation
// follows normalized O directly and leaves numerical stabilization for later.
export const demoBlocks = [
  { name: 'KV₀', scores: [1, 2], values: [2, 4], color: '#b7796c' },
  { name: 'KV₁', scores: [3, 1], values: [8, 6], color: '#b4996c' },
  { name: 'KV₂', scores: [2, 0], values: [1, 5], color: '#839d88' },
]

export function createMergeTrace(blocks = demoBlocks) {
  let state = { z: 0, o: 0 }
  return blocks.map(block => {
    const before = state
    const weights = block.scores.map(score => Math.exp(score))
    const z = weights.reduce((sum, w) => sum + w, 0)
    const probabilities = weights.map(w => w / z)
    const o = probabilities.reduce((sum, p, i) => sum + p * block.values[i], 0)
    const total = before.z + z
    const oldShare = before.z / total
    const newShare = z / total
    const beforeNumerator = before.o * before.z
    const incomingNumerator = weights.reduce((sum, w, i) => sum + w * block.values[i], 0)
    const mergedNumerator = beforeNumerator + incomingNumerator
    state = { z: total, o: mergedNumerator / total }
    return { block, before, weights, probabilities, local: { z, o }, oldShare, newShare,
      beforeNumerator, incomingNumerator, mergedNumerator, after: state }
  })
}

export function demoReference(blocks = demoBlocks) {
  const scores = blocks.flatMap(block => block.scores)
  const values = blocks.flatMap(block => block.values)
  const weights = scores.map(score => Math.exp(score))
  const z = weights.reduce((sum, w) => sum + w, 0)
  const probabilities = weights.map(w => w / z)
  return { probabilities, output: probabilities.reduce((sum, p, i) => sum + p * values[i], 0) }
}
