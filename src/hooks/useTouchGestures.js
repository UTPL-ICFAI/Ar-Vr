import { useEffect, useRef } from 'react';

/**
 * Touch gesture hook — pinch to scale, drag to reposition.
 *
 * @param {React.RefObject} containerRef – element to attach listeners to
 * @param {(key: string, value: number) => void} onAdjustment – called with 'scale'|'x'|'y' changes
 * @param {Object} adjustments – current { scale, x, y, z }
 */
export default function useTouchGestures(containerRef, onAdjustment, adjustments) {
  const initialPinchDist = useRef(null);
  const initialScale     = useRef(null);
  const dragStart        = useRef(null);
  const initialX         = useRef(null);
  const initialY         = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function dist(t1, t2) {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function handleTouchStart(e) {
      if (e.touches.length === 2) {
        // Pinch start
        e.preventDefault();
        initialPinchDist.current = dist(e.touches[0], e.touches[1]);
        initialScale.current = adjustments.scale;
      } else if (e.touches.length === 1) {
        // Drag start
        dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        initialX.current = adjustments.x;
        initialY.current = adjustments.y;
      }
    }

    function handleTouchMove(e) {
      if (e.touches.length === 2 && initialPinchDist.current != null) {
        // Pinch → scale
        e.preventDefault();
        const curDist = dist(e.touches[0], e.touches[1]);
        const ratio = curDist / initialPinchDist.current;
        const newScale = Math.max(0.1, Math.min(3, initialScale.current * ratio));
        onAdjustment('scale', Math.round(newScale * 100) / 100);
      } else if (e.touches.length === 1 && dragStart.current) {
        // Drag → reposition (only with deliberate gesture, ignore accidental)
        const dx = e.touches[0].clientX - dragStart.current.x;
        const dy = e.touches[0].clientY - dragStart.current.y;

        // Require a minimum drag distance to activate
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          // Map pixel drag to adjustment units (100 = full offset)
          const sensitivity = 0.5;
          const newX = Math.max(-200, Math.min(200, initialX.current + dx * sensitivity));
          const newY = Math.max(-200, Math.min(200, initialY.current - dy * sensitivity));
          onAdjustment('x', Math.round(newX));
          onAdjustment('y', Math.round(newY));
        }
      }
    }

    function handleTouchEnd() {
      if (initialPinchDist.current != null) {
        initialPinchDist.current = null;
        initialScale.current = null;
      }
      dragStart.current = null;
      initialX.current = null;
      initialY.current = null;
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove',  handleTouchMove,  { passive: false });
    el.addEventListener('touchend',   handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove',  handleTouchMove);
      el.removeEventListener('touchend',   handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [containerRef, onAdjustment, adjustments]);
}
