declare module 'react' {
  export const useCallback: any;
  export const useEffect: any;
  export const useRef: any;
  export const useState: any;
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
