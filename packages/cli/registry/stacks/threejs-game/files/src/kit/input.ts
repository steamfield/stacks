/**
 * Named-action input for keyboard and touch. Games read actions (`isDown('jump')`,
 * `vector('move')`), never raw events, so tests can inject input at the action level and a new
 * device only touches this file.
 *
 * Call `update()` once at the start of every logic tick; `justPressed` is relative to the previous
 * tick.
 */

export interface DirectionalVector<A extends string> {
  left: A;
  right: A;
  up: A;
  down: A;
}

export interface TouchLayout<A extends string> {
  /** Actions on the left-hand d-pad, as left/right/up/down. Omit for no d-pad. */
  dpad?: DirectionalVector<A>;
  /** Action buttons on the right, listed bottom-right first. */
  buttons?: { action: A; label: string }[];
}

export interface InputOptions<A extends string, V extends string> {
  /** Action name to KeyboardEvent.code list, e.g. { jump: ['Space', 'KeyW'] }. */
  actions: Record<A, readonly string[]>;
  /** Analog-style vectors composed from four actions. */
  vectors?: Record<V, DirectionalVector<A>>;
  touch?: TouchLayout<A>;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Input<A extends string = string, V extends string = string> {
  readonly actions: readonly A[];
  isDown(action: A): boolean;
  justPressed(action: A): boolean;
  vector(name: V): Vec2;
  /** Snapshot for edge detection. Call once per logic tick, before reading input. */
  update(): void;
  /** Fires on the physical press (keydown or touch), outside the tick loop. Good for menus. */
  on(action: A, callback: () => void): () => void;
  /** Test injection: hold or release an action as if a player did. */
  inject(action: A, down: boolean): void;
  /** Attach keyboard listeners and, on touch devices, the on-screen controls. */
  mount(container: HTMLElement, options?: { forceTouch?: boolean }): void;
  destroy(): void;
}

export function createInput<A extends string, V extends string = never>(
  options: InputOptions<A, V>,
): Input<A, V> {
  const actions = Object.keys(options.actions) as A[];
  const keyToActions = new Map<string, A[]>();
  for (const action of actions) {
    for (const code of options.actions[action]) {
      keyToActions.set(code, [...(keyToActions.get(code) ?? []), action]);
    }
  }

  const keysDown = new Set<string>();
  const touchDown = new Map<A, Set<number>>();
  const injected = new Set<A>();
  /** Actions pressed since the last update(). A tap shorter than one tick still counts for one tick. */
  const latched = new Set<A>();
  let previous = new Set<A>();
  let current = new Set<A>();
  const listeners = new Map<A, Set<() => void>>();
  const cleanup: (() => void)[] = [];

  const physicallyDown = (action: A): boolean =>
    injected.has(action) ||
    (touchDown.get(action)?.size ?? 0) > 0 ||
    options.actions[action].some((code) => keysDown.has(code));

  const fire = (action: A) => {
    latched.add(action);
    for (const cb of listeners.get(action) ?? []) cb();
  };

  const input: Input<A, V> = {
    actions,
    isDown: (action) => current.has(action),
    justPressed: (action) => current.has(action) && !previous.has(action),
    vector(name) {
      const v = options.vectors?.[name];
      if (!v) {
        throw new Error(`Unknown input vector "${name}". Declare it in createInput({ vectors }).`);
      }
      let x = (current.has(v.right) ? 1 : 0) - (current.has(v.left) ? 1 : 0);
      let y = (current.has(v.down) ? 1 : 0) - (current.has(v.up) ? 1 : 0);
      if (x !== 0 && y !== 0) {
        x *= Math.SQRT1_2;
        y *= Math.SQRT1_2;
      }
      return { x, y };
    },
    update() {
      previous = current;
      current = new Set(actions.filter((a) => physicallyDown(a) || latched.has(a)));
      latched.clear();
    },
    on(action, callback) {
      const set = listeners.get(action) ?? new Set();
      set.add(callback);
      listeners.set(action, set);
      return () => set.delete(callback);
    },
    inject(action, down) {
      if (!actions.includes(action)) {
        throw new Error(`Unknown action "${action}". Known actions: ${actions.join(", ")}`);
      }
      if (down && !injected.has(action)) fire(action);
      if (down) injected.add(action);
      else injected.delete(action);
    },
    mount(container, mountOptions = {}) {
      const onKeyDown = (e: KeyboardEvent) => {
        const mapped = keyToActions.get(e.code);
        if (!mapped) return;
        e.preventDefault();
        if (!e.repeat) for (const a of mapped) fire(a);
        keysDown.add(e.code);
      };
      const onKeyUp = (e: KeyboardEvent) => keysDown.delete(e.code);
      const onBlur = () => keysDown.clear();
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);
      cleanup.push(() => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
      });

      const isTouch = mountOptions.forceTouch || window.matchMedia("(pointer: coarse)").matches;
      if (isTouch && options.touch) {
        const overlay = renderTouchOverlay(options.touch, (action, pointerId, down) => {
          const set = touchDown.get(action) ?? new Set<number>();
          if (down) {
            if (set.size === 0) fire(action);
            set.add(pointerId);
          } else set.delete(pointerId);
          touchDown.set(action, set);
        });
        container.append(overlay);
        cleanup.push(() => overlay.remove());
      }
    },
    destroy() {
      for (const fn of cleanup.splice(0)) fn();
    },
  };
  return input;
}

const OVERLAY_CSS = `
.game-touch { position: absolute; inset: 0; pointer-events: none; z-index: 10; }
.game-touch button {
  position: absolute; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none;
  width: 64px; height: 64px; border-radius: 50%; border: 2px solid rgba(255,255,255,.5);
  background: rgba(255,255,255,.15); color: #fff; font: 600 14px system-ui, sans-serif;
}
.game-touch button[data-pressed] { background: rgba(255,255,255,.4); }
.game-touch .dpad { position: absolute; width: 180px; height: 180px;
  /* 32px from the left edge keeps thumbs out of Safari's swipe-back zone. */
  left: calc(32px + env(safe-area-inset-left)); bottom: calc(24px + env(safe-area-inset-bottom)); }
.game-touch .dpad button { border-radius: 12px; width: 60px; height: 60px; }
.game-touch .actions { position: absolute; width: 170px; height: 170px;
  right: calc(24px + env(safe-area-inset-right)); bottom: calc(24px + env(safe-area-inset-bottom)); }
`;

function renderTouchOverlay<A extends string>(
  layout: TouchLayout<A>,
  onChange: (action: A, pointerId: number, down: boolean) => void,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "game-touch";
  root.dataset.testid = "touch-overlay";
  const style = document.createElement("style");
  style.textContent = OVERLAY_CSS;
  root.append(style);

  const makeButton = (action: A, label: string, css: Partial<CSSStyleDeclaration>) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.dataset.action = action;
    b.setAttribute("aria-label", action);
    Object.assign(b.style, css);
    const release = (e: PointerEvent) => {
      delete b.dataset.pressed;
      onChange(action, e.pointerId, false);
    };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.dataset.pressed = "";
      onChange(action, e.pointerId, true);
    });
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  };

  if (layout.dpad) {
    const pad = document.createElement("div");
    pad.className = "dpad";
    const { left, right, up, down } = layout.dpad;
    pad.append(
      makeButton(up, "▲", { left: "60px", top: "0" }),
      makeButton(left, "◀", { left: "0", top: "60px" }),
      makeButton(right, "▶", { left: "120px", top: "60px" }),
      makeButton(down, "▼", { left: "60px", top: "120px" }),
    );
    root.append(pad);
  }
  if (layout.buttons?.length) {
    const actions = document.createElement("div");
    actions.className = "actions";
    const spots = [
      { right: "0", bottom: "0" },
      { right: "90px", bottom: "30px" },
      { right: "30px", bottom: "90px" },
      { right: "100px", bottom: "100px" },
    ];
    layout.buttons.slice(0, spots.length).forEach((btn, i) => {
      actions.append(makeButton(btn.action, btn.label, spots[i] ?? {}));
    });
    root.append(actions);
  }
  return root;
}
