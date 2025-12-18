/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TouchVisualizer } from '../../../src/webview/TouchVisualizer';

describe('TouchVisualizer', () => {
  let container: HTMLElement;
  let visualizer: TouchVisualizer;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';

    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    document.body.appendChild(container);
    visualizer = new TouchVisualizer(container);
  });

  afterEach(() => {
    visualizer.dispose();
    document.body.removeChild(container);
  });

  describe('enable/disable', () => {
    it('should not show ripples when disabled', () => {
      visualizer.setEnabled(false);
      visualizer.showRipple(0, 0.5, 0.5);
      expect(container.querySelector('.touch-ripple')).toBeNull();
    });

    it('should show ripples when enabled', () => {
      visualizer.setEnabled(true);
      visualizer.showRipple(0, 0.5, 0.5);
      expect(container.querySelector('.touch-ripple')).not.toBeNull();
    });

    it('should clear all ripples when disabled', () => {
      visualizer.setEnabled(true);
      visualizer.showRipple(0, 0.5, 0.5);
      visualizer.showRipple(1, 0.3, 0.3);
      expect(container.querySelectorAll('.touch-ripple').length).toBe(2);

      visualizer.setEnabled(false);
      expect(container.querySelectorAll('.touch-ripple').length).toBe(0);
    });
  });

  describe('ripple positioning', () => {
    beforeEach(() => {
      visualizer.setEnabled(true);
    });

    it('should position ripple at correct coordinates', () => {
      visualizer.showRipple(0, 0.5, 0.5);
      const ripple = container.querySelector('.touch-ripple') as HTMLElement;
      expect(ripple).not.toBeNull();
      // 0.5 * 800 = 400, 0.5 * 600 = 300
      expect(ripple.style.left).toBe('400px');
      expect(ripple.style.top).toBe('300px');
    });

    it('should position ripple at top-left for (0, 0)', () => {
      visualizer.showRipple(0, 0, 0);
      const ripple = container.querySelector('.touch-ripple') as HTMLElement;
      expect(ripple.style.left).toBe('0px');
      expect(ripple.style.top).toBe('0px');
    });

    it('should position ripple at bottom-right for (1, 1)', () => {
      visualizer.showRipple(0, 1, 1);
      const ripple = container.querySelector('.touch-ripple') as HTMLElement;
      expect(ripple.style.left).toBe('800px');
      expect(ripple.style.top).toBe('600px');
    });
  });

  describe('ripple movement (no-op for performance)', () => {
    beforeEach(() => {
      visualizer.setEnabled(true);
    });

    it('should NOT move ripple on moveRipple call (stays at original position)', () => {
      visualizer.showRipple(0, 0.5, 0.5);
      visualizer.moveRipple(0, 0.75, 0.75);
      const ripple = container.querySelector('.touch-ripple') as HTMLElement;
      // Ripple should stay at original position (0.5 * 800 = 400, 0.5 * 600 = 300)
      expect(ripple.style.left).toBe('400px');
      expect(ripple.style.top).toBe('300px');
    });

    it('should not throw on moveRipple for non-existent ripple', () => {
      // Should not throw
      visualizer.moveRipple(999, 0.5, 0.5);
      expect(container.querySelector('.touch-ripple')).toBeNull();
    });
  });

  describe('ripple hiding', () => {
    beforeEach(() => {
      visualizer.setEnabled(true);
    });

    it('should add fading class on hideRipple', () => {
      visualizer.showRipple(0, 0.5, 0.5);
      visualizer.hideRipple(0);
      const ripple = container.querySelector('.touch-ripple') as HTMLElement;
      expect(ripple.classList.contains('touch-ripple-fading')).toBe(true);
    });

    it('should remove ripple after animation completes', async () => {
      visualizer.showRipple(0, 0.5, 0.5);
      const ripple = container.querySelector('.touch-ripple') as HTMLElement;

      visualizer.hideRipple(0);

      // Trigger animationend event
      ripple.dispatchEvent(new Event('animationend'));

      // Ripple should be removed
      expect(container.querySelector('.touch-ripple')).toBeNull();
    });

    it('should not throw when hiding non-existent ripple', () => {
      // Should not throw
      visualizer.hideRipple(999);
    });
  });

  describe('multi-touch support', () => {
    beforeEach(() => {
      visualizer.setEnabled(true);
    });

    it('should support multiple simultaneous ripples', () => {
      visualizer.showRipple(0, 0.25, 0.25);
      visualizer.showRipple(1, 0.75, 0.75);
      expect(container.querySelectorAll('.touch-ripple').length).toBe(2);
    });

    it('should track ripples by pointerId (movement is no-op)', () => {
      visualizer.showRipple(0, 0.25, 0.25);
      visualizer.showRipple(1, 0.75, 0.75);

      // Move is a no-op, ripples stay at original positions
      visualizer.moveRipple(1, 0.5, 0.5);

      const ripples = container.querySelectorAll('.touch-ripple') as NodeListOf<HTMLElement>;
      // First ripple should be at original position
      expect(ripples[0].style.left).toBe('200px'); // 0.25 * 800
      // Second ripple should also be at original position (move is no-op)
      expect(ripples[1].style.left).toBe('600px'); // 0.75 * 800
    });

    it('should hide ripples independently', async () => {
      visualizer.showRipple(0, 0.25, 0.25);
      visualizer.showRipple(1, 0.75, 0.75);

      visualizer.hideRipple(0);
      const ripple0 = container.querySelectorAll('.touch-ripple')[0] as HTMLElement;
      ripple0.dispatchEvent(new Event('animationend'));

      // Only one ripple should remain
      expect(container.querySelectorAll('.touch-ripple').length).toBe(1);
    });
  });

  describe('ripple CSS classes', () => {
    beforeEach(() => {
      visualizer.setEnabled(true);
    });

    it('should have active class on show', () => {
      visualizer.showRipple(0, 0.5, 0.5);
      const ripple = container.querySelector('.touch-ripple') as HTMLElement;
      expect(ripple.classList.contains('touch-ripple-active')).toBe(true);
    });

    it('should replace active with fading class on hide', () => {
      visualizer.showRipple(0, 0.5, 0.5);
      visualizer.hideRipple(0);
      const ripple = container.querySelector('.touch-ripple') as HTMLElement;
      expect(ripple.classList.contains('touch-ripple-active')).toBe(false);
      expect(ripple.classList.contains('touch-ripple-fading')).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should remove all ripples on dispose', () => {
      visualizer.setEnabled(true);
      visualizer.showRipple(0, 0.5, 0.5);
      visualizer.showRipple(1, 0.3, 0.3);
      expect(container.querySelectorAll('.touch-ripple').length).toBe(2);

      visualizer.dispose();
      expect(container.querySelectorAll('.touch-ripple').length).toBe(0);
    });

    it('should be safe to call dispose multiple times', () => {
      visualizer.setEnabled(true);
      visualizer.showRipple(0, 0.5, 0.5);

      visualizer.dispose();
      visualizer.dispose();
      expect(container.querySelectorAll('.touch-ripple').length).toBe(0);
    });
  });

  describe('ripple replacement', () => {
    beforeEach(() => {
      visualizer.setEnabled(true);
    });

    it('should replace existing ripple for same pointerId', () => {
      visualizer.showRipple(0, 0.25, 0.25);
      visualizer.showRipple(0, 0.75, 0.75);

      // Should only have one ripple
      expect(container.querySelectorAll('.touch-ripple').length).toBe(1);

      // Ripple should be at new position
      const ripple = container.querySelector('.touch-ripple') as HTMLElement;
      expect(ripple.style.left).toBe('600px'); // 0.75 * 800
    });
  });
});
