// Pointer drag that reorders a row or column of items inside a scroll container. The held
// item follows the pointer, the items it passes slide aside to open its landing slot, and
// holding near either container edge scrolls the container. Used by the tab strip and the
// word sidebar's cards.

export type ReorderAxis = 'x' | 'y';

export interface ReorderState {
	axis: ReorderAxis;
	fromIndex: number;
	targetIndex: number;
	offset: number;
	slotShift: number;
}

export interface ReorderDrag {
	move(clientPosition: number): void;
	// Returns the index to move the held item to, or null when it stays where it was.
	end(commit: boolean): number | null;
}

export interface ReorderDragOptions {
	axis: ReorderAxis;
	container: HTMLElement;
	items: HTMLElement[];
	fromIndex: number;
	pointerId: number;
	// Receives the pointer capture, so it must carry the move and end handlers.
	captureElement: HTMLElement;
	grabClientPosition: number;
	onChange(state: ReorderState): void;
}

const EDGE_SCROLL_ZONE_PX = 48;
const EDGE_SCROLL_MAX_STEP_PX = 14;

// Positions are in container content coordinates (scroll offset included), so they stay
// valid while the container scrolls under the held item.
export function startReorderDrag(options: ReorderDragOptions): ReorderDrag {
	// Input collection
	const { axis, container, items, fromIndex, pointerId, captureElement, onChange } = options;
	const isHorizontal = axis === 'x';
	const containerStyle = getComputedStyle(container);
	const gap = parseFloat(isHorizontal ? containerStyle.columnGap : containerStyle.rowGap) || 0;
	const containerStart = () => {
		const rect = container.getBoundingClientRect();
		return isHorizontal ? rect.left : rect.top;
	};
	const toContent = (client: number) =>
		client - containerStart() + (isHorizontal ? container.scrollLeft : container.scrollTop);
	const sizeOf = (item: HTMLElement) => (isHorizontal ? item.offsetWidth : item.offsetHeight);
	const startOf = (item: HTMLElement) => {
		const rect = item.getBoundingClientRect();
		return toContent(isHorizontal ? rect.left : rect.top);
	};

	// Processing: measure every item once, before anything moves
	const heldItem = items[fromIndex];
	const heldSize = sizeOf(heldItem);
	const originStart = startOf(heldItem);
	const minStart = startOf(items[0]);
	const lastItem = items[items.length - 1];
	const maxStart = startOf(lastItem) + sizeOf(lastItem) - heldSize;
	const otherCenters = items
		.filter((_, index) => index !== fromIndex)
		.map((item) => startOf(item) + sizeOf(item) / 2);
	const grabOffset = toContent(options.grabClientPosition) - originStart;
	const state: ReorderState = {
		axis,
		fromIndex,
		targetIndex: fromIndex,
		offset: 0,
		slotShift: heldSize + gap
	};
	let pointerClient = options.grabClientPosition;
	let frame: number | null = null;

	// Only the drawn item is clamped to the span the items occupy. The slot uses the
	// unclamped position, since a clamped center can never pass an end item of equal size.
	function update() {
		const pointerStart = toContent(pointerClient) - grabOffset;
		const shownStart = Math.min(Math.max(pointerStart, minStart), maxStart);
		const center = pointerStart + heldSize / 2;

		state.offset = shownStart - originStart;
		state.targetIndex = otherCenters.filter((otherCenter) => otherCenter < center).length;
		onChange({ ...state });
	}

	// Holding near or past either edge scrolls the container, faster the further out.
	function edgeScrollStep() {
		const rect = container.getBoundingClientRect();
		const low = (isHorizontal ? rect.left : rect.top) + EDGE_SCROLL_ZONE_PX;
		const high = (isHorizontal ? rect.right : rect.bottom) - EDGE_SCROLL_ZONE_PX;
		let depth = 0;

		if (pointerClient < low) depth = pointerClient - low;
		else if (pointerClient > high) depth = pointerClient - high;

		if (depth !== 0) {
			const step =
				Math.sign(depth) *
				EDGE_SCROLL_MAX_STEP_PX *
				Math.min(1, Math.abs(depth) / EDGE_SCROLL_ZONE_PX);
			if (isHorizontal) container.scrollLeft += step;
			else container.scrollTop += step;
			update();
		}
		frame = requestAnimationFrame(edgeScrollStep);
	}

	captureElement.setPointerCapture(pointerId);
	frame = requestAnimationFrame(edgeScrollStep);
	onChange({ ...state });

	// Output construction
	return {
		move(clientPosition: number) {
			pointerClient = clientPosition;
			update();
		},
		end(commit: boolean) {
			if (frame !== null) cancelAnimationFrame(frame);
			frame = null;
			if (captureElement.hasPointerCapture(pointerId)) {
				captureElement.releasePointerCapture(pointerId);
			}
			return commit && state.targetIndex !== fromIndex ? state.targetIndex : null;
		}
	};
}

// The held item follows the pointer. Items between its origin and target slide one slot
// toward the origin to open the gap where it will land.
export function reorderTransform(index: number, state: ReorderState | null): string {
	// Input collection
	const translate = state?.axis === 'y' ? 'translateY' : 'translateX';

	// Processing / output construction
	if (!state) return '';
	if (index === state.fromIndex) return `${translate}(${state.offset}px)`;
	if (state.fromIndex < index && index <= state.targetIndex) {
		return `${translate}(${-state.slotShift}px)`;
	}
	if (state.targetIndex <= index && index < state.fromIndex) {
		return `${translate}(${state.slotShift}px)`;
	}
	return '';
}
