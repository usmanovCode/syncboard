import type Konva from 'konva'
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Ellipse, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva'
import { exportPixelRatio, exportRegion, toPngBlob } from './exportImage'
import { isTypingTarget } from './keyboard'
import {
  contentBounds,
  createText,
  dragShape,
  isDegenerate,
  moveShapeTo,
  newShapeId,
  startShape,
  textFontSize,
} from './shapes'
import type { Point, Shape, ShapeStyle, Tool } from './types'
import {
  INITIAL_VIEWPORT,
  fitToContent,
  panBy,
  toScreen,
  toWorld,
  wheelPixels,
  wheelZoomFactor,
  zoomAt,
  zoomTo,
  type Viewport,
} from './viewport'
import { ZoomControls } from './ZoomControls'

/** What the page can ask of the canvas. */
export type CanvasHandle = {
  /** The whole drawing as a PNG on a white background, whatever the zoom; null for an empty board. */
  exportPng: () => Promise<Blob | null>
}

type Props = {
  ref?: Ref<CanvasHandle>
  shapes: Shape[]
  /** Viewers: nothing can be drawn, selected or moved (they can still pan and zoom). */
  readOnly?: boolean
  tool: Tool
  style: ShapeStyle
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: (shape: Shape) => void
  onUpdate: (id: string, update: (shape: Shape) => Shape) => void
  onRemove: (id: string) => void
  /** The pointer position on the board (any tool, also read-only), in board coordinates; null when it leaves. */
  onPointerPosition?: (p: Point | null) => void
  /** Drawn above the canvas, e.g. other people's cursors; must not take pointer events. */
  overlay?: (view: Viewport) => ReactNode
}

type KonvaPointerEvent = Konva.KonvaEventObject<PointerEvent>

/** Text being typed: a new text at a point, or an existing text shape (id) being edited. */
type TextEdit = { point: Point; value: string; id?: string }

/** Safari's trackpad pinch (other browsers send Ctrl+wheel). */
type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number }

/** Thin strokes are hard to hit with the eraser or select tool; widen their hit area (screen pixels). */
const MIN_HIT_WIDTH = 14

function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

const CURSORS: Record<Tool, string> = {
  select: 'default',
  pen: 'crosshair',
  rect: 'crosshair',
  ellipse: 'crosshair',
  line: 'crosshair',
  text: 'text',
  eraser: 'cell',
}

/**
 * The drawing, with pan and zoom. Everything handed in and out (shapes, pointer positions) is in board
 * coordinates; the viewport only changes how it is drawn. Zoom: Ctrl+wheel or a trackpad pinch,
 * around the pointer. Pan: Space+drag, middle-button drag, or the plain wheel / two-finger scroll.
 */
export function CanvasStage({
  ref,
  shapes,
  readOnly = false,
  tool: activeTool,
  style,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  onPointerPosition,
  overlay,
}: Props) {
  // Read-only behaves like the select tool with dragging and editing switched off below.
  const tool: Tool = readOnly ? 'select' : activeTool
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const size = useElementSize(containerRef)

  // The viewport, mirrored in a ref for the native event listeners and pointer conversions.
  const [view, setViewState] = useState<Viewport>(INITIAL_VIEWPORT)
  const viewRef = useRef(view)
  const setView = (next: Viewport) => {
    viewRef.current = next
    setViewState(next)
  }
  const onPointerPositionRef = useRef(onPointerPosition)
  useEffect(() => {
    onPointerPositionRef.current = onPointerPosition
  }, [onPointerPosition])

  // Space held: the next drag pans instead of drawing.
  const [spaceHeld, setSpaceHeldState] = useState(false)
  const spaceRef = useRef(false)
  const setSpaceHeld = (held: boolean) => {
    spaceRef.current = held
    setSpaceHeldState(held)
  }
  const pan = useRef<{ start: Point; view: Viewport } | null>(null)
  const [panning, setPanning] = useState(false)

  // The shape being drawn. Kept out of history until the pointer is released.
  const [draft, setDraft] = useState<Shape | null>(null)
  const dragStart = useRef<Point | null>(null)
  const erasing = useRef(false)
  const [textEdit, setTextEditState] = useState<TextEdit | null>(null)
  // Mirror read by commitText: Enter commits and unmounts the textarea, which may also fire blur
  // (commit again) before React re-renders. Clearing the ref first makes the second call a no-op.
  const textEditRef = useRef<TextEdit | null>(null)
  const setTextEdit = (edit: TextEdit | null) => {
    textEditRef.current = edit
    setTextEditState(edit)
  }

  useImperativeHandle(
    ref,
    () => ({
      async exportPng() {
        const stage = stageRef.current
        const bounds = contentBounds(shapes)
        if (!stage || !bounds) return null
        const region = exportRegion(bounds)
        // Konva exports a part of the stage in screen pixels: convert the board region, and divide the
        // pixel ratio by the zoom so the image comes out the same at any zoom.
        const { scale } = viewRef.current
        const at = toScreen(viewRef.current, region)
        const transformer = transformerRef.current
        const selectionVisible = transformer?.visible() ?? false
        transformer?.visible(false) // the selection frame is not part of the drawing
        let source: HTMLCanvasElement
        try {
          source = stage.toCanvas({
            x: at.x,
            y: at.y,
            width: region.width * scale,
            height: region.height * scale,
            pixelRatio: exportPixelRatio(region) / scale,
          })
        } finally {
          transformer?.visible(selectionVisible)
        }
        return toPngBlob(source)
      },
    }),
    [shapes],
  )

  // Show the selection frame around the selected shape (select tool only).
  useEffect(() => {
    const transformer = transformerRef.current
    const stage = stageRef.current
    if (!transformer || !stage) return
    const node = selectedId && tool === 'select' ? stage.findOne((n: Konva.Node) => n.id() === selectedId) : undefined
    transformer.nodes(node ? [node] : [])
  }, [selectedId, tool, shapes])

  // Wheel and pinch. Native listeners: React's wheel listener is passive, so it can't stop the
  // browser from zooming the whole page on Ctrl+wheel.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const local = (e: { clientX: number; clientY: number }): Point => {
      const rect = element.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const at = local(e)
      const delta = wheelPixels(e)
      if (e.ctrlKey || e.metaKey) {
        setView(zoomAt(viewRef.current, at, wheelZoomFactor(delta.y)))
      } else {
        setView(panBy(viewRef.current, -delta.x, -delta.y))
        // The board moved under a still pointer: tell the others where it now is.
        onPointerPositionRef.current?.(toWorld(viewRef.current, at))
      }
    }
    let gestureScale = 1
    function onGestureStart(e: Event) {
      e.preventDefault()
      gestureScale = 1
    }
    function onGestureChange(e: Event) {
      e.preventDefault()
      const gesture = e as GestureEvent
      setView(zoomAt(viewRef.current, local(gesture), gesture.scale / gestureScale))
      gestureScale = gesture.scale
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('gesturestart', onGestureStart)
    element.addEventListener('gesturechange', onGestureChange)
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('gesturestart', onGestureStart)
      element.removeEventListener('gesturechange', onGestureChange)
    }
  }, [])

  // Space for panning and Ctrl+0 for 100%, for viewers too.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault() // instead of the browser's page zoom reset
        setView(zoomTo(viewRef.current, size, 1))
        return
      }
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault() // no page scroll, no button press
        if (!spaceRef.current) setSpaceHeld(true)
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space' && spaceRef.current) {
        e.preventDefault()
        setSpaceHeld(false)
      }
    }
    // Released while the window wasn't focused: don't stay in pan mode.
    const onBlur = () => setSpaceHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [size])

  /** The pointer in screen pixels (relative to the canvas), as Konva reports it. */
  const screenPointer = (): Point | null => stageRef.current?.getPointerPosition() ?? null
  /** The pointer on the board. */
  const pointer = (): Point | null => {
    const p = screenPointer()
    return p ? toWorld(viewRef.current, p) : null
  }

  function eraseAtPointer() {
    const p = screenPointer() // Konva hit-tests in screen pixels
    const id = p ? stageRef.current?.getIntersection(p)?.id() : undefined
    if (id) onRemove(id)
  }

  function commitText() {
    const edit = textEditRef.current
    if (!edit) return
    setTextEdit(null)
    const text = edit.value.trim() ? edit.value : ''
    if (edit.id) {
      const id = edit.id
      if (text) onUpdate(id, (shape) => (shape.type === 'text' && shape.text !== text ? { ...shape, text } : shape))
      else onRemove(id)
    } else if (text) {
      onAdd(createText(edit.point, text, style, newShapeId()))
    }
  }

  function handlePointerDown(event: KonvaPointerEvent) {
    const screen = screenPointer()
    if (!screen) return
    if (event.evt.button === 1 || spaceRef.current) {
      pan.current = { start: screen, view: viewRef.current }
      setPanning(true)
      return
    }
    const p = toWorld(viewRef.current, screen)
    if (textEditRef.current || textEdit) {
      // Clicking elsewhere finishes the text being typed (like blur), without starting something new.
      commitText()
      return
    }
    switch (tool) {
      case 'select':
        if (!readOnly && event.target === event.target.getStage()) onSelect(null)
        return
      case 'eraser':
        erasing.current = true
        eraseAtPointer()
        return
      case 'text':
        setTextEdit({ point: p, value: '' })
        return
      default:
        dragStart.current = p
        setDraft(startShape(tool, p, style, newShapeId()))
    }
  }

  function handlePointerMove(event: KonvaPointerEvent) {
    const screen = screenPointer()
    if (pan.current) {
      // The board point under the pointer stays the same while panning: no cursor update needed.
      if (screen) {
        const { start, view: from } = pan.current
        setView(panBy(from, screen.x - start.x, screen.y - start.y))
      }
      return
    }
    const p = pointer()
    if (p) onPointerPosition?.(p)
    if (erasing.current) {
      eraseAtPointer()
      return
    }
    const start = dragStart.current
    if (!start || !p) return
    const constrain = 'shiftKey' in event.evt && event.evt.shiftKey
    setDraft((current) => (current ? dragShape(current, start, p, constrain) : current))
  }

  function finishPointer() {
    if (pan.current) {
      pan.current = null
      setPanning(false)
      return
    }
    erasing.current = false
    dragStart.current = null
    if (draft && !isDegenerate(draft)) onAdd(draft)
    setDraft(null)
  }

  // Shapes can't be picked up while Space is held: that drag pans.
  const canSelect = tool === 'select' && !readOnly && !spaceHeld

  function renderShape(shape: Shape, isDraft = false) {
    const common = {
      id: isDraft ? undefined : shape.id,
      x: shape.x,
      y: shape.y,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
      hitStrokeWidth: Math.max(shape.strokeWidth, MIN_HIT_WIDTH / view.scale),
      listening: !isDraft,
      draggable: canSelect && !isDraft,
      onPointerDown: canSelect
        ? (event: KonvaPointerEvent) => {
            if (event.evt?.button !== 1) onSelect(shape.id)
          }
        : undefined,
      onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) =>
        onUpdate(shape.id, (s) => moveShapeTo(s, event.target.x(), event.target.y())),
    }
    switch (shape.type) {
      case 'pen':
        return (
          <Line key={shape.id} {...common} points={shape.points} tension={0.4} lineCap="round" lineJoin="round" />
        )
      case 'line':
        return <Line key={shape.id} {...common} points={shape.points} lineCap="round" />
      case 'rect':
        return <Rect key={shape.id} {...common} width={shape.width} height={shape.height} />
      case 'ellipse':
        return <Ellipse key={shape.id} {...common} radiusX={shape.radiusX} radiusY={shape.radiusY} />
      case 'text':
        return (
          <Text
            key={shape.id}
            {...common}
            stroke={undefined}
            fill={shape.stroke}
            text={shape.text}
            fontSize={shape.fontSize}
            fontFamily="system-ui, sans-serif"
            visible={textEdit?.id !== shape.id}
            onDblClick={() =>
              tool === 'select' && !readOnly && setTextEdit({ point: { x: shape.x, y: shape.y }, value: shape.text, id: shape.id })
            }
          />
        )
    }
  }

  const editingShape = textEdit?.id ? shapes.find((s) => s.id === textEdit.id) : undefined
  const editFontSize = editingShape?.type === 'text' ? editingShape.fontSize : textFontSize(style.strokeWidth)
  const textColor = editingShape?.stroke ?? style.stroke
  const textAt = textEdit ? toScreen(view, textEdit.point) : null

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={t('board.canvas')}
      className="relative min-h-0 flex-1 overflow-hidden bg-white"
      style={{ cursor: panning ? 'grabbing' : spaceHeld ? 'grab' : CURSORS[tool] }}
      // The middle button pans; don't let the browser start auto-scrolling.
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerLeave={() => {
          finishPointer()
          onPointerPosition?.(null)
        }}
      >
        <Layer>
          {shapes.map((shape) => renderShape(shape))}
          {draft && renderShape(draft, true)}
          <Transformer ref={transformerRef} resizeEnabled={false} rotateEnabled={false} borderDash={[4, 4]} />
        </Layer>
      </Stage>

      {overlay?.(view)}

      {textEdit && textAt && (
        <textarea
          aria-label={t('board.textLabel')}
          placeholder={t('board.textPlaceholder')}
          autoFocus
          value={textEdit.value}
          onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commitText()
            } else if (e.key === 'Escape') {
              setTextEdit(null)
            }
          }}
          rows={Math.max(1, textEdit.value.split('\n').length)}
          className="absolute min-w-48 resize-none border border-dashed border-indigo-400 bg-transparent p-0 leading-none outline-none"
          style={{
            left: textAt.x,
            top: textAt.y,
            fontSize: editFontSize * view.scale,
            color: textColor,
            fontFamily: 'system-ui, sans-serif',
          }}
        />
      )}

      <ZoomControls
        scale={view.scale}
        onReset={() => setView(zoomTo(view, size, 1))}
        onFit={() => setView(fitToContent(contentBounds(shapes), size))}
      />
    </div>
  )
}
