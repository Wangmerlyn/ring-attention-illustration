<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import Icon from './components/Icon.vue'
import KvBlock from './components/KvBlock.vue'
import OnlineSoftmaxDemo from './components/OnlineSoftmaxDemo.vue'
import { accumulate, denseAttention, makeExample, ownerAtRound, partition, scoresForBlock } from './attention.js'

const devices = ref(4)
const sequenceLength = ref(4096)
const causal = ref(false)
const speed = ref(1)
const selected = ref(0)
const rounds = ref(0)
const playing = ref(false)
const stepping = ref(false)
const moving = ref(false)
const progress = ref(0)
const showDetails = ref(false)
const reducedMotion = ref(false)
const colors = ['#c17473', '#c5a475', '#7e9b87', '#838cae', '#aa86a9', '#729eaa', '#ad9d73', '#b98572']
const subscripts = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇']
const indices = computed(() => Array.from({ length: devices.value }, (_, i) => i))
const done = computed(() => rounds.value === devices.value)
const activeRound = computed(() => Math.min(rounds.value, devices.value - 1))
const currentBlock = computed(() => ownerAtRound(selected.value, activeRound.value, devices.value))
const example = computed(() => makeExample(devices.value))
const accumulator = computed(() => accumulate(example.value, selected.value, rounds.value, devices.value, causal.value))
const dense = computed(() => denseAttention(example.value, selected.value * 2, causal.value))
const error = computed(() => Math.max(...accumulator.value.o.map((value, i) => Math.abs(value - dense.value[i]))))
const processed = computed(() => new Set(Array.from({ length: rounds.value }, (_, r) => ownerAtRound(selected.value, r, devices.value))))
const blockScores = computed(() => scoresForBlock(example.value, selected.value * 2, currentBlock.value, causal.value))
const skipping = computed(() => causal.value && currentBlock.value > selected.value)
const stageTitle = computed(() => done.value ? '所有分块已完成' : moving.value ? '计算与传递，同时发生' : rounds.value === 0 ? '从本地分块开始' : '新的 K/V 分块已就位')
const stageDescription = computed(() => done.value
  ? `每台设备完成 ${devices.value} 轮遍历，保留自己的输出 O。无需收集完整注意力矩阵。`
  : moving.value
    ? rounds.value === devices.value - 1 ? '最后一轮：合并当前分块，完成输出，不再发送 K/V。' : `各设备计算当前分块，同时把 K/V 发给下一台设备。Q 始终留在原处。`
    : rounds.value === 0 ? '长序列沿 token 维度分片，每台设备持有自己的 Q、K 和 V。' : '上一轮的结果已合并。继续播放，使用本地 Q 计算收到的 K/V。')

function point(angle, radius = devices.value === 4 ? 174 : 185) {
  const rad = angle * Math.PI / 180
  return { x: 400 + radius * Math.cos(rad), y: 250 + radius * Math.sin(rad) }
}
function angle(i) { return (devices.value === 4 ? -135 : -90) + i * 360 / devices.value }
const nodes = computed(() => indices.value.map(i => ({ i, ...point(angle(i)) })))
const arcs = computed(() => indices.value.map(i => {
  const margin = devices.value === 4 ? 26 : 19
  const start = point(angle(i) + margin)
  const end = point(angle(i) + 360 / devices.value - margin)
  const radius = devices.value === 4 ? 174 : 185
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`
}))
const packets = computed(() => indices.value.map(i => ({
  i, owner: ownerAtRound(i, activeRound.value, devices.value),
  ...point(angle(i) + (360 / devices.value) * progress.value),
})))

function stateOf(row, column) {
  if (causal.value && column > row) return 'masked'
  const visitRound = ownerAtRound(row, column, devices.value)
  if (visitRound < rounds.value) return 'complete'
  if (!done.value && column === ownerAtRound(row, rounds.value, devices.value)) return moving.value ? 'active' : 'queued'
  return 'pending'
}
function cellLabel(row, column) {
  const descriptions = { masked: '因果掩码：跳过未来 token', complete: '已合并', active: '正在计算', queued: '下一轮计算', pending: '尚未计算' }
  return `Q${row} × K${column}：${descriptions[stateOf(row, column)]}，查看 GPU ${row}`
}
function rangeLabel(i) {
  const [start, end] = partition(sequenceLength.value, devices.value, i)
  return `${start.toLocaleString()}–${(end - 1).toLocaleString()}`
}
function format(value) { return value === -Infinity ? '−∞' : value.toFixed(3) }
function reset() {
  rounds.value = 0
  progress.value = 0
  playing.value = false
  stepping.value = false
  moving.value = false
  idleTime = 0
}
function startRound() {
  if (done.value) return
  progress.value = 0
  moving.value = true
  idleTime = 0
}
function togglePlay() {
  if (playing.value || stepping.value) {
    playing.value = false
    stepping.value = false
    return
  }
  if (done.value) reset()
  playing.value = true
  if (!moving.value) startRound()
}
function next() {
  if (done.value) return
  playing.value = false
  stepping.value = true
  if (!moving.value) startRound()
}
function seek(round) {
  reset()
  rounds.value = round
}
function changeSpeed() { speed.value = speed.value === 2 ? 0.5 : speed.value === 0.5 ? 1 : 2 }
function keydown(event) {
  if (event.target.closest('button, input, select, textarea, a, summary') || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.code === 'Space') { event.preventDefault(); togglePlay() }
  if (event.code === 'ArrowRight') { event.preventDefault(); next() }
  if (event.code === 'KeyR') reset()
}
watch([devices, sequenceLength, causal], () => {
  reset()
  if (selected.value >= devices.value) selected.value = 0
})
let frameId, lastTime = 0, idleTime = 0, motionPreference
function tick(time) {
  const delta = lastTime ? Math.min(time - lastTime, 80) : 0
  lastTime = time
  if (playing.value || stepping.value) {
    if (moving.value) {
      progress.value = Math.min(1, progress.value + delta * speed.value / 2600)
      if (progress.value >= 1) {
        rounds.value++
        moving.value = false
        stepping.value = false
        progress.value = 0
        idleTime = 0
        if (done.value) playing.value = false
      }
    } else if (playing.value && !done.value) {
      idleTime += delta
      if (idleTime > 450 / speed.value) startRound()
    }
  }
  frameId = requestAnimationFrame(tick)
}
function updateMotionPreference(event) { reducedMotion.value = event.matches }
onMounted(() => {
  frameId = requestAnimationFrame(tick)
  document.addEventListener('keydown', keydown)
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = motionPreference.matches
  motionPreference.addEventListener('change', updateMotionPreference)
})
onUnmounted(() => {
  cancelAnimationFrame(frameId)
  document.removeEventListener('keydown', keydown)
  motionPreference?.removeEventListener('change', updateMotionPreference)
})
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <a class="brand" href="#" aria-label="Attention Lab 首页">
        <span class="brand-mark"><i></i><i></i><i></i><i></i></span>
        attention<span class="brand-light">lab</span><span class="brand-dot">.</span>
      </a>
      <nav aria-label="页面导航">
        <a href="#simulation" class="nav-link active">交互演示</a>
        <a href="#principles" class="nav-link">计算原理</a>
        <a href="#online-softmax" class="nav-link nav-softmax">Online softmax</a>
        <a href="https://arxiv.org/abs/2310.01889" target="_blank" rel="noopener noreferrer" class="paper-link">阅读论文 <Icon name="external" :size="14" /></a>
      </nav>
    </header>

    <main>
      <section class="intro" aria-labelledby="page-title">
        <div>
          <div class="eyebrow"><span></span> AN INTERACTIVE EXPLAINER <span class="eyebrow-number">01 / ATTENTION</span></div>
          <h1 id="page-title">Ring Attention<span class="title-period">.</span></h1>
          <p class="intro-description">让数据流动，让计算留在原地。<span>一步步理解长序列如何在多台 GPU 上协同计算。</span></p>
        </div>
        <div class="intro-note"><span class="tiny-ring">↻</span><div>一份完整的注意力，<br />在一个环中完成。</div></div>
      </section>

      <section id="simulation" class="simulation" aria-label="Ring Attention 交互模拟">
        <div class="configuration">
          <div class="configuration-label"><Icon name="chip" :size="18" /> 模拟配置</div>
          <div class="config-field"><label for="device-count">设备数量</label><div class="select-wrap"><select id="device-count" v-model.number="devices"><option :value="4">4 GPUs</option><option :value="6">6 GPUs</option><option :value="8">8 GPUs</option></select><Icon name="chevron" :size="13" /></div></div>
          <div class="config-field"><label for="sequence-length">序列长度</label><div class="select-wrap"><select id="sequence-length" v-model.number="sequenceLength"><option :value="4096">4,096 tokens</option><option :value="8192">8,192 tokens</option><option :value="16384">16,384 tokens</option></select><Icon name="chevron" :size="13" /></div></div>
          <div class="config-field attention-field"><span id="attention-type">注意力类型</span><div class="segmented" role="group" aria-labelledby="attention-type"><button :class="{ selected: !causal }" :aria-pressed="!causal" @click="causal = false">Full</button><button :class="{ selected: causal }" :aria-pressed="causal" @click="causal = true">Causal</button></div></div>
          <span class="configuration-hint">改变配置将重新开始</span>
        </div>

        <div class="workspace">
          <div class="ring-panel">
            <div class="panel-heading"><div class="panel-name"><span class="section-index">01</span><h2>环形计算拓扑</h2></div><span class="live-status" :class="{ running: playing || stepping, finished: done }"><i></i>{{ done ? '计算完成' : playing || stepping ? '正在运行' : moving ? '已暂停' : '准备就绪' }}</span></div>
            <div class="diagram-viewport" :class="{ 'wide-topology': devices > 4 }">
            <div class="ring-diagram" :class="[{ 'is-working': moving && (playing || stepping), 'is-finished': done, 'reduced-motion': reducedMotion }, `devices-${devices}`]">
              <svg class="ring-svg" viewBox="0 0 800 500" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <marker id="arrowhead" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="#b9b6b0" stroke-width="1.2" /></marker>
                  <marker id="arrowhead-active" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="#b35853" stroke-width="1.2" /></marker>
                </defs>
                <circle cx="400" cy="250" :r="devices === 4 ? 174 : 185" class="ring-guide" />
                <circle cx="400" cy="250" :r="devices === 4 ? 118 : 116" class="inner-guide" />
                <path v-for="(arc, i) in arcs" :key="i" :d="arc" class="connection" :class="{ highlighted: moving && !done && rounds < devices - 1 }" :marker-end="moving && rounds < devices - 1 ? 'url(#arrowhead-active)' : 'url(#arrowhead)'" />
                <g v-if="moving && rounds < devices - 1 && !reducedMotion" class="kv-packets">
                  <g v-for="packet in packets" :key="packet.i" :transform="`translate(${packet.x}, ${packet.y})`">
                    <rect x="-26" y="-13" width="52" height="26" rx="6" :fill="colors[packet.owner]" />
                    <text text-anchor="middle" dominant-baseline="central">KV{{ subscripts[packet.owner] }}</text>
                  </g>
                </g>
              </svg>

              <div class="ring-center">
                <div class="center-kicker">{{ done ? 'ALL BLOCKS VISITED' : 'COMPUTE ROUND' }}</div>
                <div class="round-number"><span>{{ done ? devices : activeRound + 1 }}</span><span class="round-denominator">/ {{ devices }}</span></div>
                <div class="center-caption">{{ done ? '完整 attention 已就绪' : moving ? (rounds < devices - 1 ? '计算 + K/V 传递' : '最终结果合并') : 'Q 固定 · K/V 顺时针流动' }}</div>
                <div class="center-progress"><span :style="{ width: `${done ? 100 : moving ? progress * 100 : 0}%` }"></span></div>
              </div>

              <button v-for="node in nodes" :key="node.i" class="gpu-node" :class="{ 'selected-node': selected === node.i, computing: moving, 'node-done': done }" :style="{ left: `${node.x / 8}%`, top: `${node.y / 5}%`, '--kv-color': colors[ownerAtRound(node.i, activeRound, devices)] }" :aria-pressed="selected === node.i" :aria-label="`查看 GPU ${node.i}，本地 Q${node.i}，当前 K/V${ownerAtRound(node.i, activeRound, devices)}`" @click="selected = node.i">
                <div class="node-heading"><span><Icon name="chip" :size="14" />GPU {{ node.i }}</span><span class="node-status">{{ done ? '完成' : moving && causal && ownerAtRound(node.i, activeRound, devices) > node.i ? '掩码跳过' : moving ? '计算中' : '本地设备' }}</span></div>
                <div class="node-blocks">
                  <span class="q-block">Q{{ subscripts[node.i] }}<span class="lock-dot"></span></span>
                  <KvBlock :label="`K${subscripts[ownerAtRound(node.i, activeRound, devices)]}`" :color="colors[ownerAtRound(node.i, activeRound, devices)]" :reduced-motion="reducedMotion" />
                  <KvBlock :label="`V${subscripts[ownerAtRound(node.i, activeRound, devices)]}`" :color="colors[ownerAtRound(node.i, activeRound, devices)]" :reduced-motion="reducedMotion" />
                </div>
                <div class="node-range">tokens {{ rangeLabel(node.i) }}</div>
                <div class="node-output"><span>O{{ subscripts[node.i] }}</span><div><i v-for="r in devices" :key="r" :class="{ filled: r <= rounds, current: r === rounds + 1 && moving }"></i></div><span>{{ rounds }}/{{ devices }}</span></div>
              </button>
              <div class="diagram-caption"><span class="selection-dot"></span>点击设备，查看它的计算过程</div>
              <div v-if="reducedMotion && moving && rounds < devices - 1" class="motion-note">K/V 正在发送到下一设备（已减少动态效果）</div>
            </div>
            </div>
            <div v-if="devices > 4" class="pan-hint">左右滑动，查看全部设备 <Icon name="arrow" :size="13" /></div>
            <div class="diagram-legend"><span><i class="legend-q"></i>Q · 保持本地</span><span><i class="legend-kv"></i>K / V · 环形传递</span><span><i class="legend-output"></i>O · 累积输出</span><span class="legend-direction">顺时针 <Icon name="arrow" :size="15" /></span></div>
          </div>

          <aside class="inspector" aria-label="所选设备的计算详情">
            <div class="panel-heading"><div class="panel-name"><span class="section-index">02</span><h2>计算观察窗</h2></div><span class="device-tag">GPU {{ selected }}</span></div>
            <section class="matrix-section">
              <div class="inspector-label">注意力分块矩阵 <span>{{ rounds * devices }} / {{ devices * devices }} 已遍历</span></div>
              <div class="matrix-x-label">KEY BLOCKS →</div>
              <div class="attention-matrix" :style="{ '--n': devices }">
                <span class="matrix-corner">Q / K</span><span v-for="i in indices" :key="`k${i}`" class="matrix-col-label">K{{ subscripts[i] }}</span>
                <template v-for="row in indices" :key="row"><button class="matrix-row-label" :class="{ 'selected-row': selected === row }" :aria-label="`选择 GPU ${row}`" @click="selected = row">Q{{ subscripts[row] }}</button><button v-for="col in indices" :key="`${row}-${col}`" class="matrix-cell" :class="[stateOf(row, col), { 'inspected-row': selected === row, diagonal: causal && row === col }]" :title="cellLabel(row, col)" :aria-label="cellLabel(row, col)" @click="selected = row"><Icon v-if="stateOf(row, col) === 'complete'" name="check" :size="devices === 8 ? 11 : 14" /><span v-else-if="stateOf(row, col) === 'active'" class="cell-dot"></span><span v-else-if="stateOf(row, col) === 'masked'" class="masked-dash">–</span></button></template>
              </div>
              <div class="matrix-legend"><span><i class="matrix-key completed-key"></i>已合并</span><span><i class="matrix-key current-key"></i>{{ moving ? '计算中' : '下一轮' }}</span><span><i class="matrix-key pending-key"></i>{{ causal ? '斜纹为掩码' : '待计算' }}</span></div>
              <p v-if="causal" class="causal-note">上三角跳过；对角分块内仍应用 token 级因果掩码。</p>
            </section>

            <section class="operation-section">
              <div class="inspector-label">{{ done ? '完整输出' : '当前分块运算' }}<span class="operation-state">{{ done ? 'DONE' : skipping ? 'MASKED' : moving ? 'COMPUTING' : 'READY' }}</span></div>
              <div class="operation-formula" :class="{ 'formula-done': done }"><template v-if="done">O{{ subscripts[selected] }} = u{{ subscripts[selected] }} / ℓ{{ subscripts[selected] }}<Icon name="check" :size="18" /></template><template v-else>Q{{ subscripts[selected] }}<span>×</span>K{{ subscripts[currentBlock] }}<sup>T</sup><span>/ √d</span></template></div>
              <p>{{ done ? '所有有效分块的 softmax 统计量已合并。' : skipping ? '当前 K/V 对应未来 token，跳过计算；传递照常进行。' : `本地查询 Q${subscripts[selected]} 与来自 GPU ${currentBlock} 的 K/V 计算，并更新 softmax 统计量。` }}</p>
              <div class="visit-order"><span>访问顺序</span><div><template v-for="r in devices" :key="r"><span :class="{ visited: processed.has(ownerAtRound(selected, r - 1, devices)), visiting: !done && r === rounds + 1 }" :style="{ '--visit-color': colors[ownerAtRound(selected, r - 1, devices)] }">{{ ownerAtRound(selected, r - 1, devices) }}</span><span v-if="r < devices" class="visit-arrow">›</span></template></div></div>
            </section>

            <section class="accumulator-section">
              <div class="inspector-label"><a href="#online-softmax" class="softmax-entry">Online softmax <Icon name="arrow" :size="12" /></a><span>已合并 {{ rounds }} 块</span></div>
              <div class="statistics"><div><span>行最大值 m</span><strong>{{ format(accumulator.m) }}</strong></div><div><span>归一化项 ℓ</span><strong>{{ format(accumulator.l) }}</strong></div></div>
              <div class="output-vector"><span>{{ done ? '最终 O' : '当前 O' }}</span><code>[{{ accumulator.o.map(format).join(', ') }}]</code></div>
              <div v-if="done" class="verification"><Icon name="check" :size="14" /><span>与完整 attention 的最大误差 <b>{{ error.toExponential(1) }}</b></span></div>
              <p class="sample-note">数值示例：每设备 2 tokens，d = 4，显示本地首行。序列长度配置用于上方分片示意。</p>
            </section>
          </aside>
        </div>

        <div class="playback">
          <div class="playback-actions"><button class="play-button" @click="togglePlay"><Icon :name="playing || stepping ? 'pause' : done ? 'reset' : 'play'" :size="17" />{{ playing || stepping ? '暂停' : done ? '重新播放' : moving ? '继续播放' : '播放动画' }}</button><button class="secondary-button next-button" :disabled="done || stepping" @click="next"><Icon name="next" :size="17" />下一步</button><button class="icon-button" aria-label="重置动画" title="重置 (R)" @click="reset"><Icon name="reset" :size="17" /></button></div>
          <div class="timeline" aria-label="计算进度"><button class="timeline-start" :class="{ active: rounds === 0 }" aria-label="回到初始化" @click="seek(0)">初始化</button><div class="timeline-track"><div class="timeline-line"></div><div class="timeline-fill" :style="{ width: `${(rounds + (moving ? progress : 0)) / devices * 100}%` }"></div><button v-for="r in devices" :key="r" class="round-stop" :class="{ reached: rounds >= r, 'current-stop': moving && r === rounds + 1 }" :aria-label="`跳转到第 ${r} 轮完成`" :aria-pressed="rounds === r" @click="seek(r)"><span class="stop-dot"><Icon v-if="rounds >= r" name="check" :size="10" /></span><span class="stop-label">{{ devices > 4 ? r : `第 ${r} 轮` }}</span></button></div><span class="timeline-end" :class="{ active: done }">完成</span></div>
          <button class="speed-button" aria-label="切换播放速度" @click="changeSpeed"><Icon name="clock" :size="15" />{{ speed }}×</button>
        </div>
        <div class="step-description" aria-live="polite"><span class="step-icon"><Icon :name="done ? 'check' : 'info'" :size="18" /></span><div><strong>{{ stageTitle }}</strong><p>{{ stageDescription }}</p></div><div class="keyboard-hint"><Icon name="keyboard" :size="16" /><kbd>Space</kbd> 播放 / 暂停</div></div>
      </section>

      <section id="principles" class="principles" aria-labelledby="principles-title">
        <div class="principles-heading"><div><span class="eyebrow">THE IDEA BEHIND THE RING</span><h2 id="principles-title">三个动作，一份完整结果。</h2></div><button class="detail-toggle" :aria-expanded="showDetails" aria-controls="math-details" @click="showDetails = !showDetails">{{ showDetails ? '收起计算细节' : '展开计算细节' }}<Icon name="chevron" :size="16" :class="{ rotated: showDetails }" /></button></div>
        <div class="principle-columns">
          <article><span class="principle-number">01 / PARTITION</span><h3>分片，让序列各就各位。</h3><p>沿序列维度分配 Q、K、V。每台 GPU 负责自己的查询分块和输出，Q 无需移动。</p><div class="mini-partition"><span v-for="i in indices" :key="i" :style="{ background: colors[i] }">{{ i }}</span></div><span class="principle-foot">{{ sequenceLength.toLocaleString() }} tokens → {{ devices }} 个连续分块</span></article>
          <article><span class="principle-number">02 / CIRCULATE</span><h3>传递，让 K/V 走遍整个环。</h3><p>每轮将 K/V 发送给下一台 GPU，同时接收上一台的分块。计算和通信可以重叠。</p><div class="mini-circulate"><span>GPU i</span><Icon name="arrow" :size="34" /><span>GPU (i + 1) % N</span><small>K / V</small></div><span class="principle-foot">{{ devices }} 轮计算 · {{ devices - 1 }} 次设备间传递</span></article>
          <article><span class="principle-number">03 / ACCUMULATE</span><h3>合并，让局部成为完整。</h3><p>在线更新行最大值、归一化项与加权和。遍历全部 K/V 后，得到与完整 attention 等价的输出。</p><div class="mini-accumulate">m<span>+</span>ℓ<span>+</span>u<Icon name="arrow" :size="25" /><strong>O</strong></div><span class="principle-foot">无需存储完整的 N × N 注意力矩阵</span></article>
        </div>

        <div v-if="showDetails" id="math-details" class="math-details">
          <div class="math-heading"><Icon name="book" :size="19" /><h3>Online softmax 如何正确合并？</h3><span>对每个查询行分别更新</span></div>
          <div class="math-grid"><div class="math-equations"><p>S = QᵢKⱼᵀ / √d <span>因果模式在此应用掩码</span></p><p>m′ = max(m, max(S))</p><p>α = exp(m − m′), P = exp(S − m′)</p><p>ℓ′ = αℓ + ΣP</p><p>u′ = αu + PVⱼ</p><p class="final-equation">O = u / ℓ <span>全部分块完成后归一化</span></p></div><div class="math-explanation"><p><strong>为什么不能直接相加每块的 softmax？</strong><br />每一块的分母不同。保留 m、ℓ 和未归一化加权和 u，并用 α 重新缩放已有统计量，才能得到全局 softmax。</p><p>初始 m = −∞，ℓ = 0，u = 0。首次有效分块令 α = 0；完全被掩码的分块保持统计量不变。</p><p><strong>右侧的数值来自实际计算。</strong><br />当前分块首行得分：{{ done ? '已完成' : blockScores.map(format).join('，') }}。完成后会与独立的全量 attention 计算比较。</p></div></div>
          <div class="overlap-example"><div><h4>通信为什么能被隐藏？</h4><p>当分块计算时间足够覆盖传输时间时，异步发送 / 接收可与计算重叠。主图的 K/V 移动展示发送副本，当前设备仍使用当前缓冲区计算；接收完成后切换到下一缓冲区。</p></div><div class="overlap-lanes"><div><span>计算</span><div class="compute-lane">Attention(Qᵢ, Kⱼ, Vⱼ)</div></div><div><span>通信</span><div class="transfer-lane">Send K/V + Receive next K/V</div></div><small>示意时间轴，不代表实际硬件性能</small></div></div>
        </div>
      </section>
      <OnlineSoftmaxDemo :reduced-motion="reducedMotion" />
    </main>
    <footer><span><span class="footer-brand">attentionlab.</span> 为理解而构建</span><span>基于 <a href="https://arxiv.org/abs/2310.01889" target="_blank" rel="noopener noreferrer">Ring Attention · Liu et al., 2023 <Icon name="external" :size="12" /></a></span><span>Vue 3 <i></i> 前向计算演示</span></footer>
  </div>
</template>
