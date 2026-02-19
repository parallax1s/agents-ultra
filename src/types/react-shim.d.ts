declare global {
  namespace JSX {
    interface Element {}
    interface IntrinsicElements {
      [elementName: string]: unknown;
    }
  }
}

declare module "react" {
  export type ReactNode = unknown;

  export type ComponentType<Props = Record<string, never>> = (
    props: Props,
  ) => JSX.Element;

  export interface StrictModeProps {
    children?: ReactNode;
  }

  export const StrictMode: ComponentType<StrictModeProps>;

  export namespace JSX {
    interface Element extends globalThis.JSX.Element {}
    interface IntrinsicElements extends globalThis.JSX.IntrinsicElements {}
  }

  const React: {
    StrictMode: typeof StrictMode;
  };

  export default React;
}

declare module "react-dom/client" {
  export type Container = Element | DocumentFragment;

  export interface Root {
    render(children: unknown): void;
    unmount(): void;
  }

  export function createRoot(container: Container): Root;
}

declare module "react/jsx-runtime" {
  export namespace JSX {
    interface Element extends globalThis.JSX.Element {}
    interface IntrinsicElements extends globalThis.JSX.IntrinsicElements {}
  }

  export const Fragment: (props: { children?: unknown }) => JSX.Element;
  export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element;
  export function jsxs(type: unknown, props: unknown, key?: unknown): JSX.Element;
}

declare module "pixi.js" {
  export interface DestroyOptions {
    children?: boolean;
  }

  export interface LineStyleOptions {
    color?: number;
    width?: number;
    alignment?: number;
  }

  export interface ApplicationOptions {
    width?: number;
    height?: number;
    resolution?: number;
    autoDensity?: boolean;
    antialias?: boolean;
    autoStart?: boolean;
    backgroundAlpha?: number;
  }

  export class Container {
    addChild(...children: Container[]): Container;
  }

  export class Graphics extends Container {
    clear(): this;
    lineStyle(options: LineStyleOptions): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    beginFill(color?: number): this;
    drawRect(x: number, y: number, width: number, height: number): this;
    endFill(): this;
  }

  export class Application {
    view: HTMLElement;
    stage: Container;
    constructor(options?: ApplicationOptions);
    render(): void;
    destroy(removeView?: boolean, options?: DestroyOptions): void;
  }
}

export {};
