<template>
  <v-dialog v-model="open" fullscreen transition="fade-transition">
    <v-sheet
      class="position-relative d-flex align-center justify-center overflow-hidden"
      color="black"
      height="100%"
      theme="dark"
      @click="skip"
    >
      <!-- Logo, node network and light effects: drawn, so no custom CSS is needed. -->
      <canvas ref="canvas" aria-hidden="true" class="position-absolute top-0 left-0 w-100 h-100 pointer-events-none" />

      <div class="position-relative d-flex flex-column align-center text-center pa-6">
        <!-- Where the canvas draws the logo. -->
        <v-sheet
          ref="anchor"
          class="mb-8"
          color="transparent"
          height="168"
          width="168"
        />

        <v-sheet class="mb-2" color="transparent" min-height="24">
          <v-fade-transition>
            <div v-if="clock >= timeline.overline" class="text-label-large text-uppercase text-medium-emphasis">
              {{ t('welcome.overline') }}
            </div>
          </v-fade-transition>
        </v-sheet>

        <h1 :aria-label="t('app.name')" class="text-display-large font-weight-black text-no-wrap">
          <span>{{ title.first }}</span>
          <span class="text-primary">{{ title.second }}</span>
        </h1>

        <v-sheet class="mt-4" color="transparent" max-width="640" min-height="64">
          <v-slide-y-reverse-transition>
            <p v-if="clock >= timeline.tagline" class="text-headline-small font-weight-light">
              {{ t('welcome.tagline') }}
            </p>
          </v-slide-y-reverse-transition>
        </v-sheet>

        <v-sheet class="mt-2 text-mono text-body-small text-disabled" color="transparent" min-height="20">
          <span v-if="clock >= timeline.keywords">
            <span class="text-secondary">&gt;</span> {{ keywords }}<span :class="cursor ? 'text-primary' : 'opacity-0'">▍</span>
          </span>
        </v-sheet>

        <v-sheet class="mt-10 d-flex flex-column align-center" color="transparent" min-height="112">
          <v-fade-transition>
            <div v-if="clock >= timeline.actions" class="d-flex flex-column align-center">
              <v-btn-primary
                append-icon="mdi-arrow-right"
                size="x-large"
                :text="t('welcome.start')"
                @click.stop="open = false"
              />

              <v-checkbox
                v-model="dontShow"
                class="mt-4 text-medium-emphasis"
                :label="t('welcome.dontShow')"
                @click.stop
              />
            </div>
          </v-fade-transition>
        </v-sheet>
      </div>
    </v-sheet>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ComponentPublicInstance } from 'vue'

  // The welcome screen of the desktop app: shown once per startup until the
  // user turns it off here or in Settings (preference `showWelcome`). One
  // clock drives the whole intro, so a click or key press jumps to its end,
  // and reduced motion shows the end at once.

  const { t } = useI18n()
  const session = useSessionStore()
  const preferences = usePreferences()

  const open = ref(false)
  const dontShow = ref(false)

  // Opened once per startup, as soon as the stored preference is known.
  const stopWatch = watch(() => [session.isDesktop, preferences.query.data.value?.showWelcome] as const, ([desktop, show]) => {
    if (desktop && show !== undefined) {
      open.value = show
      queueMicrotask(() => stopWatch())
    }
  }, { immediate: true })

  watch(open, (value, previous) => {
    if (previous && !value && dontShow.value) {
      void preferences.update(current => ({ ...current, showWelcome: false }))
    }
  })

  /** When each part of the intro starts, in milliseconds. */
  const timeline = {
    line: 0,
    layers: 400,
    layerStagger: 280,
    layerDuration: 1000,
    landed: 1960,
    overline: 2100,
    title: 2300,
    titleDuration: 1100,
    tagline: 3400,
    keywords: 3900,
    typing: 32,
    actions: 4700,
    end: 7000,
  }

  const clock = ref(0)

  // The product name is not translated.
  const name = ['BaSyx', 'Studio'] as const
  const glyphs = String.raw`ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&<>/\=+*`
  const fullName = name.join(' ')
  const lockTimes = [...fullName].map((_, index) => timeline.title + index * (timeline.titleDuration * 0.55 / fullName.length) + Math.random() * timeline.titleDuration * 0.45)

  /** The name decodes from random glyphs into place, letter by letter. */
  const title = computed(() => {
    const tick = Math.floor(clock.value / 50)
    const text = [...fullName].map((char, index) => {
      if (char === ' ' || clock.value >= lockTimes[index]!) {
        return char
      }
      if (clock.value < timeline.title + index * 30) {
        return ' '
      }
      return glyphs[(tick * 7 + index * 13) % glyphs.length]
    }).join('')
    return { first: text.slice(0, name[0].length), second: text.slice(name[0].length) }
  })

  const keywords = computed(() => {
    const text = t('welcome.keywords')
    return text.slice(0, Math.max(0, Math.floor((clock.value - timeline.keywords) / timeline.typing)))
  })
  const typing = computed(() => keywords.value.length < t('welcome.keywords').length)
  const cursor = computed(() => typing.value || Math.floor(clock.value / 530) % 2 === 0)

  // ---- Drawing -------------------------------------------------------------

  const canvas = ref<HTMLCanvasElement | null>(null)
  const anchor = ref<ComponentPublicInstance | null>(null)

  const brand = { cyan: '0, 173, 238', orange: '246, 146, 34', gray: '146, 148, 151' }

  /** The three layers of app/assets/basyx-logo.svg, bottom first, in its 1000-unit space. */
  const layers = [
    { color: brand.gray, from: [299.53, 533.18], to: [704.09, 937.74], path: 'M547.25,485.48l311.33,203.89c33.22,21.76,33.22,70.44,0,92.2L547.25,985.45c-27.6,18.07-63.28,18.07-90.87,0L145.04,781.56c-33.22-21.76-33.22-70.44,0-92.2l311.33-203.89C483.97,467.4,519.66,467.4,547.25,485.48z' },
    { color: brand.cyan, from: [299.53, 298.72], to: [704.09, 703.28], path: 'M547.25,251.01L858.59,454.9c33.22,21.76,33.22,70.44,0,92.2L547.25,750.99c-27.6,18.07-63.28,18.07-90.87,0L145.04,547.1c-33.22-21.76-33.22-70.44,0-92.2l311.33-203.89C483.97,232.94,519.66,232.94,547.25,251.01z' },
    { color: brand.orange, from: [299.53, 64.26], to: [704.09, 468.82], path: 'M547.25,16.55l311.33,203.89c33.22,21.76,33.22,70.44,0,92.2L547.25,516.52c-27.6,18.07-63.28,18.07-90.87,0L145.04,312.64c-33.22-21.76-33.22-70.44,0-92.2L456.38,16.55C483.97-1.52,519.66-1.52,547.25,16.55z' },
  ] as const

  interface NetworkNode {
    x: number
    y: number
    vx: number
    vy: number
    r: number
    rgb: string
    born: number
  }

  interface Pulse {
    from: NetworkNode
    to: NetworkNode
    start: number
  }

  const easeOutCubic = (p: number) => 1 - (1 - p) ** 3
  const easeOutExpo = (p: number) => p >= 1 ? 1 : 1 - 2 ** (-10 * p)
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

  let context: CanvasRenderingContext2D | null = null
  let paths: Path2D[] = []
  let nodes: NetworkNode[] = []
  let pulses: Pulse[] = []
  let width = 0
  let height = 0
  let start = 0
  let last = 0
  let frame = 0
  let nextPulse = 0
  let pointer: { x: number, y: number } | null = null
  let observer: ResizeObserver | null = null
  const reducedMotion = import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function randomNode (born: number): NetworkNode {
    const roll = Math.random()
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.012,
      vy: (Math.random() - 0.5) * 0.012,
      r: 0.8 + Math.random() * 1.4,
      rgb: roll < 0.78 ? brand.cyan : (roll < 0.9 ? brand.orange : brand.gray),
      born,
    }
  }

  function resize () {
    const element = canvas.value
    if (!element) {
      return
    }
    const ratio = window.devicePixelRatio || 1
    width = element.clientWidth
    height = element.clientHeight
    element.width = Math.round(width * ratio)
    element.height = Math.round(height * ratio)
    context?.setTransform(ratio, 0, 0, ratio, 0, 0)
    // About one node per 16 000 px², kept as they are when the window changes.
    const count = Math.round(Math.min(120, Math.max(40, width * height / 16_000)))
    nodes = nodes.slice(0, count)
    while (nodes.length < count) {
      nodes.push(randomNode(Math.random() * 1600))
    }
    if (reducedMotion) {
      draw(timeline.end)
    }
  }

  /** The logo's centre in canvas coordinates. */
  function logoCentre () {
    const element = anchor.value?.$el as HTMLElement | undefined
    if (!element || !canvas.value) {
      return { x: width / 2, y: height / 2 - 120 }
    }
    const box = element.getBoundingClientRect()
    const origin = canvas.value.getBoundingClientRect()
    return { x: box.left - origin.left + box.width / 2, y: box.top - origin.top + box.height / 2 }
  }

  function draw (time: number, delta = 0) {
    const ctx = context
    if (!ctx) {
      return
    }
    const centre = logoCentre()
    const intro = clamp01(time / 1500)

    // Deep space with a cool glow behind the logo.
    ctx.fillStyle = '#04070B'
    ctx.fillRect(0, 0, width, height)

    const landing = time - timeline.landed
    const bump = landing > 0 ? Math.exp(-landing / 700) : 0
    const breathe = 0.5 + 0.5 * Math.sin(time / 1800)
    const halo = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, Math.max(width, height) * 0.55)
    halo.addColorStop(0, `rgba(${brand.cyan}, ${(0.07 + 0.03 * breathe + 0.12 * bump) * intro})`)
    halo.addColorStop(0.5, `rgba(${brand.cyan}, ${0.02 * intro})`)
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, width, height)

    drawNetwork(ctx, time, delta)
    drawLine(ctx, time, centre)
    drawRings(ctx, time, centre)
    drawLogo(ctx, time, centre)

    // Vignette: the edges fall off into black.
    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.75)
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.75)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, width, height)
  }

  /** Drifting nodes, linked when close: the shells of an infrastructure. */
  function drawNetwork (ctx: CanvasRenderingContext2D, time: number, delta: number) {
    const reach = 150
    for (const node of nodes) {
      node.x += node.vx * delta
      node.y += node.vy * delta
      if (node.x < -20) {
        node.x = width + 20
      } else if (node.x > width + 20) {
        node.x = -20
      }
      if (node.y < -20) {
        node.y = height + 20
      } else if (node.y > height + 20) {
        node.y = -20
      }
    }

    ctx.lineWidth = 0.6
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!
      const fadeA = clamp01((time - a.born) / 1200)
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (distance < reach) {
          const alpha = (1 - distance / reach) * 0.22 * Math.min(fadeA, clamp01((time - b.born) / 1200))
          ctx.strokeStyle = `rgba(${brand.cyan}, ${alpha})`
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }
      if (pointer) {
        const distance = Math.hypot(a.x - pointer.x, a.y - pointer.y)
        if (distance < reach * 1.3) {
          ctx.strokeStyle = `rgba(${brand.orange}, ${(1 - distance / (reach * 1.3)) * 0.35 * fadeA})`
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(pointer.x, pointer.y)
          ctx.stroke()
        }
      }
      ctx.fillStyle = `rgba(${a.rgb}, ${0.7 * fadeA})`
      ctx.beginPath()
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Data pulses travel along the links.
    if (!reducedMotion && time > timeline.landed && time > nextPulse && nodes.length > 1) {
      nextPulse = time + 250 + Math.random() * 450
      const from = nodes[Math.floor(Math.random() * nodes.length)]!
      const near = nodes.filter(node => node !== from && Math.hypot(node.x - from.x, node.y - from.y) < reach)
      const to = near[Math.floor(Math.random() * near.length)]
      if (to) {
        pulses.push({ from, to, start: time })
      }
    }
    pulses = pulses.filter(pulse => time - pulse.start < 900)
    for (const pulse of pulses) {
      const p = easeOutCubic((time - pulse.start) / 900)
      const x = pulse.from.x + (pulse.to.x - pulse.from.x) * p
      const y = pulse.from.y + (pulse.to.y - pulse.from.y) * p
      ctx.save()
      ctx.shadowColor = `rgb(${brand.cyan})`
      ctx.shadowBlur = 12
      ctx.fillStyle = `rgba(220, 245, 255, ${Math.sin(p * Math.PI)})`
      ctx.beginPath()
      ctx.arc(x, y, 1.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  /** The opening: a thin line of light across the dark. */
  function drawLine (ctx: CanvasRenderingContext2D, time: number, centre: { x: number, y: number }) {
    const p = time / 1800
    if (p >= 1) {
      return
    }
    const reach = width * 0.5 * easeOutExpo(clamp01(time / 900))
    const alpha = Math.sin(clamp01(p) * Math.PI) * 0.9
    const gradient = ctx.createLinearGradient(centre.x - reach, 0, centre.x + reach, 0)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(0.5, `rgba(${brand.cyan}, ${alpha})`)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(centre.x - reach, centre.y - 0.75, reach * 2, 1.5)
  }

  /** Two isometric shock waves as the last layer lands. */
  function drawRings (ctx: CanvasRenderingContext2D, time: number, centre: { x: number, y: number }) {
    for (const [index, rgb] of [brand.cyan, brand.orange].entries()) {
      const p = (time - timeline.landed - index * 220) / 1600
      if (p <= 0 || p >= 1) {
        continue
      }
      const radius = 90 + easeOutCubic(p) * Math.max(width, height) * 0.6
      ctx.strokeStyle = `rgba(${rgb}, ${(1 - p) * 0.45})`
      ctx.lineWidth = 1.5 * (1 - p) + 0.3
      ctx.beginPath()
      ctx.ellipse(centre.x, centre.y + 30, radius, radius * 0.5, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  /** The logo's layers drop into place one by one, then breathe apart and together. */
  function drawLogo (ctx: CanvasRenderingContext2D, time: number, centre: { x: number, y: number }) {
    const scale = 168 / 1000
    const settled = time - timeline.landed
    const glow = settled > 0 ? 0.35 + 0.65 * Math.exp(-settled / 900) + 0.15 * Math.sin(settled / 1400) : 0
    for (const [index, layer] of layers.entries()) {
      const p = clamp01((time - timeline.layers - index * timeline.layerStagger) / timeline.layerDuration)
      if (p <= 0) {
        continue
      }
      const drop = (1 - easeOutCubic(p)) * -320
      const spread = settled > 0 ? Math.sin(settled / 1400) * (index - 1) * 10 * (1 - Math.exp(-settled / 1500)) : 0
      ctx.save()
      ctx.globalAlpha = easeOutCubic(p)
      ctx.translate(centre.x - 500 * scale, centre.y - 500 * scale)
      ctx.scale(scale, scale)
      ctx.translate(0, drop + spread)
      const gradient = ctx.createLinearGradient(layer.from[0], layer.from[1], layer.to[0], layer.to[1])
      gradient.addColorStop(0, `rgba(${layer.color}, 0)`)
      gradient.addColorStop(1, `rgb(${layer.color})`)
      ctx.fillStyle = gradient
      ctx.shadowColor = `rgba(${layer.color}, 0.8)`
      ctx.shadowBlur = 36 * glow
      ctx.fill(paths[index]!)
      ctx.restore()
    }
  }

  function loop (now: number) {
    const time = now - start
    const delta = last ? Math.min(64, now - last) : 0
    last = now
    clock.value = time
    draw(time, delta)
    frame = requestAnimationFrame(loop)
  }

  /** Jumps to the end of the intro (a click or key press while it plays). */
  function skip () {
    if (clock.value < timeline.end) {
      start = performance.now() - timeline.end
    }
  }

  function onKey (event: KeyboardEvent) {
    if (event.key === 'Enter' && clock.value >= timeline.actions) {
      open.value = false
    } else if (event.key !== 'Escape') {
      skip()
    }
  }

  function onPointer (event: PointerEvent) {
    const origin = canvas.value?.getBoundingClientRect()
    pointer = origin ? { x: event.clientX - origin.left, y: event.clientY - origin.top } : null
  }

  function stop () {
    cancelAnimationFrame(frame)
    observer?.disconnect()
    observer = null
    context = null
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('pointermove', onPointer)
  }

  watch(canvas, element => {
    stop()
    if (!element) {
      return
    }
    context = element.getContext('2d')
    paths = layers.map(layer => new Path2D(layer.path))
    nodes = []
    pulses = []
    last = 0
    observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    window.addEventListener('keydown', onKey)
    if (reducedMotion) {
      clock.value = timeline.end
      draw(timeline.end)
      return
    }
    window.addEventListener('pointermove', onPointer)
    start = performance.now()
    frame = requestAnimationFrame(loop)
  })

  onBeforeUnmount(stop)
</script>
