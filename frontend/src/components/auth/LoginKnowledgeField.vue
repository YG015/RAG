<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import {
  useKnowledgeField,
  type KnowledgeFieldLabels,
  type KnowledgeKind,
  type KnowledgeFieldSelection,
} from '@/composables/useKnowledgeField'

const props = defineProps<{
  labels: KnowledgeFieldLabels
  pulse: number
  focusCluster: KnowledgeKind | null
}>()

const emit = defineEmits<{
  select: [selection: KnowledgeFieldSelection]
}>()

const hostRef = useTemplateRef<HTMLElement>('host')
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvas')

const fieldLabels = computed(() => props.labels)
const fieldPulse = computed(() => props.pulse)
const fieldFocus = computed(() => props.focusCluster)

useKnowledgeField(canvasRef, hostRef, {
  labels: fieldLabels,
  pulse: fieldPulse,
  focusCluster: fieldFocus,
  onSelect: (selection) => emit('select', selection),
})
</script>

<template>
  <div ref="host" class="knowledge-field" aria-hidden="true">
    <div class="knowledge-field__aurora knowledge-field__aurora--a" />
    <div class="knowledge-field__aurora knowledge-field__aurora--b" />
    <div class="knowledge-field__aurora knowledge-field__aurora--c" />
    <div class="knowledge-field__grid" />
    <canvas ref="canvas" class="knowledge-field__canvas" />
  </div>
</template>

<style scoped lang="less">
.knowledge-field {
  pointer-events: none;
  z-index: 0;
  font-family: var(--app-font-family);
  --field-edge: rgba(7, 192, 95, 0.2);
  --field-edge-hot: rgba(6, 176, 77, 0.55);
  --field-node-fill: rgba(255, 255, 255, 0.9);
  --field-node-stroke: rgba(7, 192, 95, 0.34);
  --field-node-core: #07c05f;
  --field-node-hot: #12d18a;
  --field-packet: #0ecf86;
  --field-label: #14352c;
  --field-glow: rgba(14, 224, 138, 0.22);
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(1200px 680px at 12% 18%, rgba(126, 232, 176, 0.34), transparent 58%),
    radial-gradient(900px 560px at 78% 8%, rgba(168, 236, 214, 0.28), transparent 52%),
    linear-gradient(135deg, #eef8f3 0%, #f7fbf8 46%, #e4f3ec 100%);
}

.knowledge-field__aurora {
  position: absolute;
  border-radius: 999px;
  filter: blur(40px);
  pointer-events: none;
  will-change: transform, opacity;
}

.knowledge-field__aurora--a {
  width: 42vw;
  height: 42vw;
  left: -8vw;
  top: -10vw;
  background: rgba(64, 214, 148, 0.28);
  animation: field-drift-a 18s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
}

.knowledge-field__aurora--b {
  width: 34vw;
  height: 34vw;
  right: 8vw;
  top: 12vh;
  background: rgba(92, 214, 196, 0.2);
  animation: field-drift-b 22s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
}

.knowledge-field__aurora--c {
  width: 38vw;
  height: 28vw;
  left: 18vw;
  bottom: -8vw;
  background: rgba(186, 236, 168, 0.22);
  animation: field-drift-c 26s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
}

.knowledge-field__grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(16, 84, 58, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(16, 84, 58, 0.045) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: radial-gradient(ellipse at 35% 45%, #000 35%, transparent 78%);
}

.knowledge-field__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}

@keyframes field-drift-a {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.8; }
  50% { transform: translate3d(6%, 8%, 0) scale(1.08); opacity: 1; }
}

@keyframes field-drift-b {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.7; }
  50% { transform: translate3d(-7%, 5%, 0) scale(1.12); opacity: 1; }
}

@keyframes field-drift-c {
  0%, 100% { transform: translate3d(0, 0, 0); opacity: 0.65; }
  50% { transform: translate3d(4%, -6%, 0); opacity: 0.9; }
}

@media (prefers-reduced-motion: reduce) {
  .knowledge-field__aurora {
    animation: none;
  }
}
</style>

<style lang="less">
html[theme-mode="dark"] .knowledge-field {
  --field-edge: rgba(126, 255, 196, 0.22);
  --field-edge-hot: rgba(126, 255, 196, 0.58);
  --field-node-fill: rgba(18, 64, 54, 0.78);
  --field-node-stroke: rgba(186, 255, 226, 0.28);
  --field-node-core: #7dffc2;
  --field-node-hot: #b6ffdc;
  --field-packet: #9dffd0;
  --field-label: #e9fff6;
  --field-glow: rgba(126, 255, 196, 0.22);
  background:
    radial-gradient(1000px 620px at 18% 12%, rgba(70, 210, 160, 0.28), transparent 58%),
    radial-gradient(800px 520px at 80% 18%, rgba(80, 190, 170, 0.18), transparent 52%),
    linear-gradient(135deg, #1c4e43 0%, #24584c 48%, #163f36 100%);
}
</style>
