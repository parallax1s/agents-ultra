declare module 'react' {
  export as namespace React;

  export function useCallback<T extends (...a: any[]) => any>(cb: T, deps: readonly any[]): T;
  export function useEffect(cb: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(fn: () => T, deps: readonly any[]): T;
  export function useRef<T>(init: T): { current: T };
  export function useRef<T>(init: T | null): { current: T | null };
  export function useState<S>(init: S): [S, (s: S) => void];
  export const Fragment: any;
  export const ReactDefault: any;
  export default ReactDefault;

  declare namespace React {
    type FC<P = {}> = (props: P & { children?: any }) => any;
    interface CSSProperties {
      [k: string]: string | number;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [el: string]: any;
    }
  }
}

declare module 'react-dom/client' {
  export function createRoot(...args: any[]): any;
}

declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: unknown, key?: unknown): any;
  export function jsxs(type: unknown, props: unknown, key?: unknown): any;
}

declare module 'pixi.js' {
  export interface Application extends Record<string, any> {}
  export interface Container extends Record<string, any> {}
  export interface Graphics extends Record<string, any> {}

  export const Ticker: any;
  export const Sprite: any;
  export const Texture: any;
}
