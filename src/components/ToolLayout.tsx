import { Badge, Heading, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";
import type { ToolDefinition } from "../types/tool";

type ToolLayoutProps = {
  readonly tool: Pick<ToolDefinition, "category" | "name" | "summary">;
  readonly children: ReactNode;
};

export function ToolLayout({ tool, children }: ToolLayoutProps) {
  return (
    <section className="tool-page">
      <header className="tool-heading">
        <Badge color="gray" variant="soft">
          {tool.category}
        </Badge>
        <Heading as="h1" size="7">
          {tool.name}
        </Heading>
        <Text as="p" color="gray" size="3">
          {tool.summary}
        </Text>
      </header>
      <div className="tool-workspace">{children}</div>
    </section>
  );
}
