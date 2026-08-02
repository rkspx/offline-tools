import {
  MagnifyingGlassIcon,
  SidebarSimpleIcon,
  ToolboxIcon,
} from "@phosphor-icons/react";
import { IconButton, TextField } from "@radix-ui/themes";
import { useMemo, useState, type ReactNode } from "react";
import type { ToolDefinition } from "../types/tool";

type AppShellProps = {
  readonly tools: readonly ToolDefinition[];
  readonly activeSlug: string | undefined;
  readonly children: ReactNode;
};

export function AppShell({ tools, activeSlug, children }: AppShellProps) {
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return tools;
    return tools.filter((tool) =>
      `${tool.name} ${tool.summary} ${tool.category}`.toLocaleLowerCase().includes(normalized),
    );
  }, [query, tools]);

  return (
    <div className="app-frame">
      <header className="mobile-header">
        <a className="brand" href="#/" aria-label="Minitools home">
          <ToolboxIcon aria-hidden size={22} weight="duotone" />
          <span>Minitools</span>
        </a>
        <IconButton
          variant="ghost"
          color="gray"
          aria-label="Toggle tool navigation"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <SidebarSimpleIcon aria-hidden size={20} />
        </IconButton>
      </header>

      <aside className={sidebarOpen ? "sidebar is-open" : "sidebar"}>
        <a className="brand desktop-brand" href="#/" onClick={() => setSidebarOpen(false)}>
          <ToolboxIcon aria-hidden size={22} weight="duotone" />
          <span>Minitools</span>
        </a>
        <TextField.Root
          size="2"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search tools"
          aria-label="Search tools"
        >
          <TextField.Slot>
            <MagnifyingGlassIcon aria-hidden size={16} />
          </TextField.Slot>
        </TextField.Root>
        <nav className="tool-nav" aria-label="Tools">
          {filteredTools.map((tool) => (
            <a
              key={tool.slug}
              className={tool.slug === activeSlug ? "tool-link is-active" : "tool-link"}
              href={`#/${tool.slug}`}
              aria-current={tool.slug === activeSlug ? "page" : undefined}
              onClick={() => setSidebarOpen(false)}
            >
              <span>{tool.name}</span>
              <small>{tool.category}</small>
            </a>
          ))}
          {filteredTools.length === 0 ? (
            <p className="search-empty">No tools match your search.</p>
          ) : null}
        </nav>
      </aside>
      {sidebarOpen ? (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Close tool navigation"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <main className="main-content">{children}</main>
    </div>
  );
}
