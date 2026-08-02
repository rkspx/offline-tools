import type { ComponentType, LazyExoticComponent } from "react";

export type ToolCategory =
  | "Media"
  | "Data"
  | "Documents"
  | "Security"
  | "Design"
  | "Developer";

export type Capability = "crossOriginIsolated" | "fileSystemAccess" | "webCodecs" | "webGpu";

export type ToolDefinition = {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly category: ToolCategory;
  readonly capabilities?: readonly Capability[];
  readonly component: LazyExoticComponent<ComponentType>;
};
