/**
 * Stand-in for react-konva in jsdom (no real <canvas>). Stage renders a <div data-testid="stage">
 * that forwards pointer events as Konva-like event objects; shapes render as <div data-testid="shape">.
 * Tests steer the pointer position and eraser hit through `konvaState`, and can call a rendered
 * shape's Konva handlers (e.g. onDragEnd) through `konvaState.props`.
 *
 * Usage in a test file:  vi.mock('react-konva', () => import('../test/konvaMock'))
 */
import { forwardRef, useImperativeHandle, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

type Props = Record<string, unknown> & { children?: ReactNode }

// Test-only module: fast refresh does not apply.
// oxlint-disable-next-line react/only-export-components
export const konvaState = {
  pointer: { x: 0, y: 0 },
  /** id of the shape under the pointer, for the eraser (Stage.getIntersection). */
  hit: null as string | null,
  /** Latest props of each rendered shape, by id. */
  props: new Map<string, Props>(),
  reset() {
    this.pointer = { x: 0, y: 0 }
    this.hit = null
    this.props.clear()
  },
}

const fakeStage = {
  getPointerPosition: () => konvaState.pointer,
  getIntersection: () => (konvaState.hit ? { id: () => konvaState.hit } : null),
  findOne: () => undefined,
  getStage: () => fakeStage,
}

type Handler = ((event: unknown) => void) | undefined

/** Like Konva, events on a shape bubble to the stage with the shape (not the stage) as target. */
function konvaEvent(event: ReactPointerEvent) {
  const onShape = (event.target as HTMLElement).closest('[data-testid="shape"]')
  return { evt: event.nativeEvent, target: onShape ? { getStage: () => fakeStage } : fakeStage }
}

export const Stage = forwardRef<typeof fakeStage, Props>(function Stage(props, ref) {
  useImperativeHandle(ref, () => fakeStage)
  const handler = (name: string) => (event: ReactPointerEvent) => (props[name] as Handler)?.(konvaEvent(event))
  return (
    <div
      data-testid="stage"
      onPointerDown={handler('onPointerDown')}
      onPointerMove={handler('onPointerMove')}
      onPointerUp={handler('onPointerUp')}
      onPointerLeave={handler('onPointerLeave')}
    >
      {props.children as ReactNode}
    </div>
  )
})

export function Layer({ children }: Props) {
  return <div>{children}</div>
}

export const Transformer = forwardRef<{ nodes: () => void }, Props>(function Transformer(_props, ref) {
  useImperativeHandle(ref, () => ({ nodes: () => {} }))
  return null
})

function renderShape(kind: string, props: Props) {
  const id = props.id as string | undefined
  if (id) konvaState.props.set(id, props)
  if (props.visible === false) return null
  return (
    <div
      data-testid="shape"
      data-kind={kind}
      data-id={id ?? 'draft'}
      data-stroke={(props.stroke ?? props.fill) as string}
      onPointerDown={() => (props.onPointerDown as Handler)?.({})}
    >
      {props.text as string}
    </div>
  )
}

export function Line(props: Props) {
  return renderShape('Line', props)
}
export function Rect(props: Props) {
  return renderShape('Rect', props)
}
export function Ellipse(props: Props) {
  return renderShape('Ellipse', props)
}
export function Text(props: Props) {
  return renderShape('Text', props)
}
