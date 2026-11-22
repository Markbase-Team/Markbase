"use client";

import * as React from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "./utils";

// Generic drag-and-drop kanban. Owns all dnd-kit wiring (sensors, cross-column
// move, in-column reorder, drag overlay) and is generic over the item type.
// The parent owns the data: it passes a flat `items` list + `getColumnId`, and
// receives an `onChange` with the move + the new per-column id order to persist.

export type KanbanColumn = {
  id: string;
  header?: React.ReactNode;
  accent?: boolean; // amber emphasis ring (e.g. "needs attention")
  emptyLabel?: React.ReactNode;
};

export type KanbanChange = {
  itemId: string;
  from: string;
  to: string;
  moved: boolean; // true when the item changed columns
  columns: Record<string, string[]>; // new id order per column id
};

export type KanbanProps<T extends { id: string }> = {
  columns: KanbanColumn[];
  items: T[];
  getColumnId: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onChange: (change: KanbanChange) => void;
  className?: string;
  columnClassName?: string;
  setColumnRef?: (id: string, el: HTMLDivElement | null) => void;
};

// Prefer droppables the pointer is actually inside. `closestCorners` (distance
// to droppable corners) tends to skip EMPTY columns — a card in a neighbouring
// column wins, so you can't drop into a column that has no cards. `pointerWithin`
// targets whatever column the pointer is over (empty or not) and sorts by
// center distance, so a card still wins for in-column reordering. Fall back to
// `closestCorners` when there's no pointer (e.g. keyboard dragging).
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

function buildOrder<T extends { id: string }>(
  items: T[],
  columns: KanbanColumn[],
  getColumnId: (item: T) => string
): Record<string, string[]> {
  const order: Record<string, string[]> = {};
  for (const c of columns) order[c.id] = [];
  for (const item of items) {
    const col = getColumnId(item);
    (order[col] ??= []).push(item.id);
  }
  return order;
}

function SortableCard({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(
        // `touch-auto` keeps native scrolling in BOTH directions on touch — a
        // swipe scrolls the column (vertical) or the board (horizontal). The
        // TouchSensor's long-press delay is what distinguishes a swipe (scroll)
        // from a deliberate card drag, so we don't reserve any axis here.
        // select-none + no touch-callout so a long-press starts a drag instead
        // of selecting the card's text / popping the iOS selection menu.
        "cursor-grab touch-auto select-none [-webkit-touch-callout:none] active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
    >
      {children}
    </div>
  );
}

function Column({
  column,
  itemIds,
  className,
  setColumnRef,
  children,
}: {
  column: KanbanColumn;
  itemIds: string[];
  className?: string;
  setColumnRef?: (id: string, el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });
  return (
    <div
      ref={(el) => setColumnRef?.(column.id, el)}
      className={cn(
        "flex w-80 shrink-0 flex-col rounded-lg border bg-card",
        column.accent && "border-amber-400 ring-2 ring-amber-300",
        className
      )}
    >
      {column.header}
      <div
        ref={setNodeRef}
        // overflow-x-clip is load-bearing: `overflow-y: auto` would otherwise
        // force overflow-x to `auto` too (CSS spec), turning this into a
        // horizontal scroll container that swallows sideways swipes before they
        // reach the board's horizontal scroller. `clip` is not a scroll
        // container, so horizontal pans bubble up and scroll between columns.
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-clip overflow-y-auto p-2"
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {itemIds.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
              {column.emptyLabel ?? "Nothing here yet."}
            </div>
          ) : (
            children
          )}
        </SortableContext>
      </div>
    </div>
  );
}

export function Kanban<T extends { id: string }>({
  columns,
  items,
  getColumnId,
  renderCard,
  onChange,
  className,
  columnClassName,
  setColumnRef,
}: KanbanProps<T>) {
  const [order, setOrder] = React.useState<Record<string, string[]>>(() =>
    buildOrder(items, columns, getColumnId)
  );
  const orderRef = React.useRef(order);
  orderRef.current = order;
  const draggedFrom = React.useRef<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const byId = React.useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i])) as Record<string, T>,
    [items]
  );

  // Reseed the internal order when the incoming item order or the columns
  // change — so an externally-driven re-sort (e.g. by priority) reflows, while
  // a drag (which doesn't change the items prop) is left untouched.
  const signature =
    items.map((i) => i.id).join("|") +
    "::" +
    columns.map((c) => c.id).join("|");
  const sigRef = React.useRef(signature);
  React.useEffect(() => {
    if (sigRef.current !== signature) {
      sigRef.current = signature;
      setOrder(buildOrder(items, columns, getColumnId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Mouse: start dragging after a small move. Touch: require a long press
  // (hold ~250ms without moving past the tolerance) before a drag begins — so a
  // plain horizontal/vertical swipe scrolls the board/column natively, and only
  // a deliberate long-press picks a card up to move it between columns.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const findContainer = React.useCallback((id: string): string | null => {
    const cols = orderRef.current;
    if (id in cols) return id;
    return Object.keys(cols).find((key) => cols[key].includes(id)) ?? null;
  }, []);

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveId(id);
    draggedFrom.current = findContainer(id);
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const activeContainer = findContainer(activeId);
    const overContainer = findContainer(overId);
    if (!activeContainer || !overContainer || activeContainer === overContainer)
      return;
    setOrder((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const overIndex = overItems.indexOf(overId);
      const insertAt = overId in prev ? overItems.length : Math.max(overIndex, 0);
      return {
        ...prev,
        [activeContainer]: activeItems.filter((id) => id !== activeId),
        [overContainer]: [
          ...overItems.slice(0, insertAt),
          activeId,
          ...overItems.slice(insertAt),
        ],
      };
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const activeId = String(active.id);
    setActiveId(null);
    const from = draggedFrom.current;
    draggedFrom.current = null;
    if (!over) return;

    const container = findContainer(activeId);
    if (!container) return;

    let cols = orderRef.current;
    const overId = String(over.id);
    const items = cols[container];
    const oldIndex = items.indexOf(activeId);
    const newIndex = overId in cols ? items.length - 1 : items.indexOf(overId);
    if (newIndex >= 0 && oldIndex !== newIndex) {
      cols = { ...cols, [container]: arrayMove(items, oldIndex, newIndex) };
      setOrder(cols);
    }

    onChange({
      itemId: activeId,
      from: from ?? container,
      to: container,
      moved: !!from && from !== container,
      columns: cols,
    });
  }

  const activeItem = activeId ? byId[activeId] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        draggedFrom.current = null;
      }}
    >
      <div className={cn("flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2", className)}>
        {columns.map((column) => {
          const ids = order[column.id] ?? [];
          return (
            <Column
              key={column.id}
              column={column}
              itemIds={ids}
              className={columnClassName}
              setColumnRef={setColumnRef}
            >
              {ids.map((id) => {
                const item = byId[id];
                if (!item) return null;
                return (
                  <SortableCard key={id} id={id}>
                    {renderCard(item)}
                  </SortableCard>
                );
              })}
            </Column>
          );
        })}
      </div>
      <DragOverlay>
        {activeItem ? renderCard(activeItem) : null}
      </DragOverlay>
    </DndContext>
  );
}
