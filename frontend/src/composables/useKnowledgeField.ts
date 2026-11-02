import { onBeforeUnmount, onMounted, toValue, watch, type MaybeRefOrGetter } from 'vue'

export type KnowledgeKind = 'rag' | 'agent' | 'wiki' | 'hybrid' | 'doc'

export interface KnowledgeFieldLabels {
  rag: string
  agent: string
  wiki: string
  hybrid: string
  doc: string
}

export interface KnowledgeFieldSelection {
  kind: KnowledgeKind
  label: string
}

interface SimNode {
  kind: KnowledgeKind
  label: string
  x: number
  y: number
  vx: number
  vy: number
  homeX: number
  homeY: number
  r: number
  phase: number
  energy: number
}

interface SimEdge {
  a: number
  b: number
}

interface Packet {
  edge: number
  t: number
  speed: number
  dir: number
  life: number
}

interface Palette {
  edge: string
  edgeHot: string
  nodeFill: string
  nodeStroke: string
  nodeCore: string
  nodeHot: string
  packet: string
  label: string
  glow: string
  fontFamily: string
}

interface UseKnowledgeFieldOptions {
  labels: MaybeRefOrGetter<KnowledgeFieldLabels>
  pulse?: MaybeRefOrGetter<number>
  focusCluster?: MaybeRefOrGetter<KnowledgeKind | null>
  onSelect?: (selection: KnowledgeFieldSelection) => void
}

const KINDS: KnowledgeKind[] = ['wiki', 'rag', 'hybrid', 'agent', 'doc']

const CLUSTER_HOMES: Record<KnowledgeKind, { x: number; y: number; count: number }> = {
  wiki: { x: 0.18, y: 0.30, count: 7 },
  rag: { x: 0.38, y: 0.20, count: 6 },
  hybrid: { x: 0.27, y: 0.52, count: 7 },
  agent: { x: 0.46, y: 0.46, count: 6 },
  doc: { x: 0.16, y: 0.72, count: 8 },
}

function mulberry32(seed: number) {
  let value = seed
  return () => {
    value |= 0
    value = (value + 0x6d2b79f5) | 0
    let t = Math.imul(value ^ (value >>> 15), 1 | value)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function readPalette(host: HTMLElement): Palette {
  const styles = getComputedStyle(host)
  const pick = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  return {
    edge: pick('--field-edge', 'rgba(7, 192, 95, 0.22)'),
    edgeHot: pick('--field-edge-hot', 'rgba(7, 192, 95, 0.55)'),
    nodeFill: pick('--field-node-fill', 'rgba(255, 255, 255, 0.88)'),
    nodeStroke: pick('--field-node-stroke', 'rgba(7, 192, 95, 0.38)'),
    nodeCore: pick('--field-node-core', '#07c05f'),
    nodeHot: pick('--field-node-hot', '#0ee08a'),
    packet: pick('--field-packet', '#12d18a'),
    label: pick('--field-label', '#14352c'),
    glow: pick('--field-glow', 'rgba(14, 224, 138, 0.28)'),
    fontFamily: styles.fontFamily || 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif',
  }
}

export function useKnowledgeField(
  canvasRef: MaybeRefOrGetter<HTMLCanvasElement | null>,
  hostRef: MaybeRefOrGetter<HTMLElement | null>,
  options: UseKnowledgeFieldOptions,
) {
  let frame = 0
  let disposed = false
  let width = 0
  let height = 0
  let dpr = 1
  let nodes: SimNode[] = []
  let edges: SimEdge[] = []
  let packets: Packet[] = []
  let palette: Palette | null = null
  let selected = -1
  let hovered = -1
  let mouseX = 0
  let mouseY = 0
  let hasMouse = false
  let reduced = false
  let resizeObserver: ResizeObserver | null = null
  let themeObserver: MutationObserver | null = null

  const layout = () => {
    const canvas = toValue(canvasRef)
    const host = toValue(hostRef)
    if (!canvas || !host) return
    const rect = host.getBoundingClientRect()
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    width = Math.max(1, Math.floor(rect.width))
    height = Math.max(1, Math.floor(rect.height))
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    palette = readPalette(host)
    rebuildHomes()
  }

  const rebuildHomes = () => {
    const labels = toValue(options.labels)
    const rand = mulberry32(2106)
    const rightLimit = width > 880 ? 0.58 : 0.92
    if (!nodes.length) {
      nodes = []
      for (const kind of KINDS) {
        const cluster = CLUSTER_HOMES[kind]
        for (let i = 0; i < cluster.count; i += 1) {
          const angle = (i / cluster.count) * Math.PI * 2 + rand() * 0.4
          const radius = 0.035 + rand() * 0.05
          const nx = Math.min(rightLimit, Math.max(0.06, cluster.x + Math.cos(angle) * radius * 1.4))
          const ny = Math.min(0.9, Math.max(0.1, cluster.y + Math.sin(angle) * radius * 1.8))
          nodes.push({
            kind,
            label: labels[kind],
            x: nx * width,
            y: ny * height,
            vx: 0,
            vy: 0,
            homeX: nx * width,
            homeY: ny * height,
            r: 4.2 + rand() * 3.4,
            phase: rand() * Math.PI * 2,
            energy: 0,
          })
        }
      }
      edges = []
      const byKind = new Map<KnowledgeKind, number[]>()
      nodes.forEach((node, index) => {
        const list = byKind.get(node.kind) ?? []
        list.push(index)
        byKind.set(node.kind, list)
      })
      for (const list of byKind.values()) {
        for (let i = 0; i < list.length; i += 1) {
          const next = list[(i + 1) % list.length]
          edges.push({ a: list[i], b: next })
          if (rand() > 0.55) {
            edges.push({ a: list[i], b: list[(i + 2) % list.length] })
          }
        }
      }
      const bridges: Array<[KnowledgeKind, KnowledgeKind]> = [
        ['wiki', 'doc'],
        ['wiki', 'hybrid'],
        ['rag', 'hybrid'],
        ['hybrid', 'agent'],
        ['agent', 'rag'],
        ['doc', 'hybrid'],
      ]
      for (const [from, to] of bridges) {
        const a = byKind.get(from) ?? []
        const b = byKind.get(to) ?? []
        if (!a.length || !b.length) continue
        edges.push({ a: a[Math.floor(rand() * a.length)], b: b[Math.floor(rand() * b.length)] })
        edges.push({ a: a[Math.floor(rand() * a.length)], b: b[Math.floor(rand() * b.length)] })
      }
      packets = Array.from({ length: 16 }, () => ({
        edge: Math.floor(rand() * edges.length),
        t: rand(),
        speed: 0.003 + rand() * 0.004,
        dir: rand() > 0.5 ? 1 : -1,
        life: 1,
      }))
      return
    }

    nodes.forEach((node, index) => {
      node.label = labels[node.kind]
      const cluster = CLUSTER_HOMES[node.kind]
      const local = index % cluster.count
      const angle = (local / cluster.count) * Math.PI * 2
      const radius = 0.04 + (index % 5) * 0.008
      const nx = Math.min(rightLimit, Math.max(0.06, cluster.x + Math.cos(angle) * radius * 1.4))
      const ny = Math.min(0.9, Math.max(0.1, cluster.y + Math.sin(angle) * radius * 1.8))
      node.homeX = nx * width
      node.homeY = ny * height
      if (reduced) {
        node.x = node.homeX
        node.y = node.homeY
      }
    })
  }

  const spawnBurst = (origin: number, count = 6) => {
    if (!edges.length) return
    const connected = edges
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => edge.a === origin || edge.b === origin)
    const pool = connected.length ? connected : edges.map((edge, index) => ({ edge, index }))
    for (let i = 0; i < count; i += 1) {
      const pick = pool[i % pool.length]
      packets.push({
        edge: pick.index,
        t: pick.edge.a === origin ? 0 : 1,
        speed: 0.01 + Math.random() * 0.01,
        dir: pick.edge.a === origin ? 1 : -1,
        life: 1,
      })
    }
    if (packets.length > 36) packets.splice(0, packets.length - 36)
  }

  const nearestNode = (x: number, y: number, threshold = 22) => {
    let best = -1
    let bestDist = threshold
    nodes.forEach((node, index) => {
      const dist = Math.hypot(node.x - x, node.y - y)
      if (dist < bestDist + node.r) {
        best = index
        bestDist = dist
      }
    })
    return best
  }

  const draw = (ctx: CanvasRenderingContext2D, time: number) => {
    const colors = palette
    if (!colors) return
    ctx.clearRect(0, 0, width, height)

    for (const edge of edges) {
      const a = nodes[edge.a]
      const b = nodes[edge.b]
      const hot = a.energy + b.energy
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      const mx = (a.x + b.x) / 2 + Math.sin(time / 900 + a.phase) * 8
      const my = (a.y + b.y) / 2 + Math.cos(time / 1100 + b.phase) * 8
      ctx.quadraticCurveTo(mx, my, b.x, b.y)
      ctx.strokeStyle = hot > 0.2 ? colors.edgeHot : colors.edge
      ctx.lineWidth = hot > 0.2 ? 1.4 : 0.9
      ctx.stroke()
    }

    for (const packet of packets) {
      const edge = edges[packet.edge]
      if (!edge) continue
      const a = nodes[edge.a]
      const b = nodes[edge.b]
      const t = packet.t
      const mx = (a.x + b.x) / 2 + Math.sin(time / 900 + a.phase) * 8
      const my = (a.y + b.y) / 2 + Math.cos(time / 1100 + b.phase) * 8
      const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y
      ctx.beginPath()
      ctx.fillStyle = colors.packet
      ctx.globalAlpha = 0.35 + packet.life * 0.65
      ctx.arc(x, y, 2.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    nodes.forEach((node, index) => {
      const active = index === selected || index === hovered || node.energy > 0.4
      const pulse = 1 + Math.sin(time / 420 + node.phase) * 0.08 + node.energy * 0.35
      const radius = node.r * pulse
      if (active) {
        ctx.beginPath()
        ctx.fillStyle = colors.glow
        ctx.arc(node.x, node.y, radius * 3.1, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.beginPath()
      ctx.fillStyle = colors.nodeFill
      ctx.strokeStyle = active ? colors.nodeHot : colors.nodeStroke
      ctx.lineWidth = active ? 1.8 : 1.1
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.fillStyle = active ? colors.nodeHot : colors.nodeCore
      ctx.arc(node.x, node.y, Math.max(1.6, radius * 0.38), 0, Math.PI * 2)
      ctx.fill()
    })

    const labelIndex = hovered >= 0 ? hovered : selected
    if (labelIndex >= 0) {
      const node = nodes[labelIndex]
      ctx.font = `600 12px ${colors.fontFamily}`
      ctx.fillStyle = colors.label
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const text = node.label
      const padX = 10
      const boxW = ctx.measureText(text).width + padX * 2
      const boxH = 24
      const boxX = Math.min(width - boxW - 12, node.x + node.r + 10)
      const boxY = Math.max(12, node.y - boxH - 8)
      ctx.fillStyle = colors.nodeFill
      ctx.strokeStyle = colors.nodeStroke
      ctx.lineWidth = 1
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(boxX, boxY, boxW, boxH, 8)
      } else {
        ctx.rect(boxX, boxY, boxW, boxH)
      }
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = colors.label
      ctx.fillText(text, boxX + padX, boxY + boxH / 2)
    }
  }

  const tick = (time: number) => {
    if (disposed) return
    const canvas = toValue(canvasRef)
    const ctx = canvas?.getContext('2d')
    if (!ctx) {
      frame = requestAnimationFrame(tick)
      return
    }

    const focus = toValue(options.focusCluster ?? null)
    if (!reduced) {
      for (const node of nodes) {
        const homePullX = (node.homeX - node.x) * 0.02
        const homePullY = (node.homeY - node.y) * 0.02
        node.vx += homePullX
        node.vy += homePullY
        if (hasMouse) {
          const dx = mouseX - node.x
          const dy = mouseY - node.y
          const dist = Math.hypot(dx, dy) || 1
          if (dist < 170) {
            const force = (1 - dist / 170) * 0.18
            node.vx += (dx / dist) * force
            node.vy += (dy / dist) * force
            node.vx += (-dy / dist) * force * 0.35
            node.vy += (dx / dist) * force * 0.35
          }
        }
        if (focus && node.kind === focus) {
          node.energy = Math.max(node.energy, 0.75)
        }
        node.vx *= 0.9
        node.vy *= 0.9
        node.x += node.vx
        node.y += node.vy
        node.energy *= 0.96
      }
      for (const packet of packets) {
        packet.t += packet.speed * packet.dir
        if (packet.t > 1 || packet.t < 0) {
          packet.dir *= -1
          packet.t = Math.min(1, Math.max(0, packet.t))
          packet.edge = Math.floor(Math.random() * edges.length)
        }
      }
    }

    draw(ctx, time)
    frame = requestAnimationFrame(tick)
  }

  const isBlockedTarget = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return false
    return Boolean(target.closest('a, button, input, textarea, select, .form-section, .header-links, .header-logo, .t-input, .t-button'))
  }

  const onPointerMove = (event: PointerEvent) => {
    const canvas = toValue(canvasRef)
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    mouseX = event.clientX - rect.left
    mouseY = event.clientY - rect.top
    hasMouse = mouseX >= 0 && mouseY >= 0 && mouseX <= width && mouseY <= height
    hovered = hasMouse ? nearestNode(mouseX, mouseY) : -1
  }

  const onPointerLeave = (event: PointerEvent) => {
    if (event.relatedTarget) return
    hasMouse = false
    hovered = -1
  }

  const onPointerDown = (event: PointerEvent) => {
    if (isBlockedTarget(event)) return
    const canvas = toValue(canvasRef)
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const index = nearestNode(x, y, 26)
    if (index < 0) return
    selected = index
    nodes[index].energy = 1
    spawnBurst(index, 8)
    options.onSelect?.({ kind: nodes[index].kind, label: nodes[index].label })
  }

  const bind = () => {
    const canvas = toValue(canvasRef)
    const host = toValue(hostRef)
    if (!canvas || !host) return
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    layout()
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerout', onPointerLeave)
    resizeObserver = new ResizeObserver(layout)
    resizeObserver.observe(host)
    themeObserver = new MutationObserver(() => {
      palette = readPalette(host)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['theme-mode'] })
    frame = requestAnimationFrame(tick)
  }

  const unbind = () => {
    disposed = true
    cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerout', onPointerLeave)
    resizeObserver?.disconnect()
    themeObserver?.disconnect()
  }

  onMounted(() => {
    bind()
  })

  onBeforeUnmount(() => {
    unbind()
  })

  watch(
    () => toValue(options.pulse ?? 0),
    (value, previous) => {
      if (!nodes.length || value === previous) return
      const focus = toValue(options.focusCluster ?? null)
      const pool = nodes
        .map((node, index) => ({ node, index }))
        .filter((item) => !focus || item.node.kind === focus)
      const pick = pool[Math.floor(Math.random() * pool.length)]
      if (!pick) return
      pick.node.energy = 1
      spawnBurst(pick.index, 7)
      selected = pick.index
    },
  )

  watch(
    () => toValue(options.labels),
    () => {
      const labels = toValue(options.labels)
      nodes.forEach((node) => {
        node.label = labels[node.kind]
      })
    },
    { deep: true },
  )

  watch(
    () => toValue(options.focusCluster ?? null),
    (kind) => {
      if (!kind) return
      nodes.forEach((node, index) => {
        if (node.kind !== kind) return
        node.energy = 1
        if (selected < 0 || nodes[selected]?.kind !== kind) selected = index
      })
      const origin = nodes.findIndex((node) => node.kind === kind)
      if (origin >= 0) spawnBurst(origin, 8)
    },
  )
}
