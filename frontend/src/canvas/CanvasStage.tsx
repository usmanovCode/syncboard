import type Konva from 'konva'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Ellipse, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva'
import { createText, dragShape, isDegenerate, moveShapeTo, newShapeId, startShape, textFontSize } from './shapes'
import type { Point, Shape, ShapeStyle, Tool } from './types'

type Props = {
  shapes: Shape[]
  /** Viewers: nothing can be drawn, selected or moved. */
  readOnly?: boolean
  tool: Tool
  style: ShapeStyle
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: (shape: Shape) => void
  onUpdate: (id: string, update: (shape: Shape) => Shape) => void
  onRemove: (id: string) => void
}

type KonvaPointerEvent = Konva.KonvaEventObject<PointerEvent>

/** Text being typed: a new text at a point, or an existing text shape (id) being edited. */
type TextEdit = { point: Point; value: string; id?: string }

/** Thin strokes are hard to hit with the eraser or select tool; widen their hit area. */
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

export function CanvasStage({
  shapes,
  readOnly = false,
  tool: activeTool,
  style,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
}: Props) {
  // Read-only behaves like the select tool with dragging and editing switched off below.
  const tool: Tool = readOnly ? 'select' : activeTool
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const size = useElementSize(containerRef)

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

  // Show the selection frame around the selected shape (select tool only).
  useEffect(() => {
    const transformer = transformerRef.current
    const stage = stageRef.current
    if (!transformer || !stage) return
    const node = selectedId && tool === 'select' ? stage.findOne((n: Konva.Node) => n.id() === selectedId) : undefined
    transformer.nodes(node ? [node] : [])
  }, [selectedId, tool, shapes])

  const pointer = (): Point | null => stageRef.current?.getPointerPosition() ?? null

  function eraseAtPointer() {
    const p = pointer()
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
    const p = pointer()
    if (!p) return
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
    if (erasing.current) {
      eraseAtPointer()
      return
    }
    const start = dragStart.current
    const p = pointer()
    if (!start || !p) return
    const constrain = 'shiftKey' in event.evt && event.evt.shiftKey
    setDraft((current) => (current ? dragShape(current, start, p, constrain) : current))
  }

  function finishPointer() {
    erasing.current = false
    dragStart.current = null
    if (draft && !isDegenerate(draft)) onAdd(draft)
    setDraft(null)
  }

  function renderShape(shape: Shape, isDraft = false) {
    const common = {
      id: isDraft ? undefined : shape.id,
      x: shape.x,
      y: shape.y,
      stroke: shape.stroke,
      strokeWidth: shape.strokeWidth,
      hitStrokeWidth: Math.max(shape.strokeWidth, MIN_HIT_WIDTH),
      listening: !isDraft,
      draggable: tool === 'select' && !isDraft && !readOnly,
      onPointerDown: tool === 'select' && !readOnly ? () => onSelect(shape.id) : undefined,
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

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={t('board.canvas')}
      className="relative min-h-0 flex-1 overflow-hidden bg-white"
      style={{ cursor: CURSORS[tool] }}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerLeave={finishPointer}
      >
        <Layer>
          {shapes.map((shape) => renderShape(shape))}
          {draft && renderShape(draft, true)}
          <Transformer ref={transformerRef} resizeEnabled={false} rotateEnabled={false} borderDash={[4, 4]} />
        </Layer>
      </Stage>

      {textEdit && (
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
            left: textEdit.point.x,
            top: textEdit.point.y,
            fontSize: editFontSize,
            color: textColor,
            fontFamily: 'system-ui, sans-serif',
          }}
        />
      )}
    </div>
  )
}
