import { ArrowRightIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { Badge, Heading, Text } from "@radix-ui/themes";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { CapabilityNotice, EmptyState } from "./components/FoundationStates";
import { ToolLayout } from "./components/ToolLayout";
import { missingCapabilities } from "./lib/capabilities";
import { getTool, tools } from "./tools/registry";

function currentSlug(): string {
  return window.location.hash.replace(/^#\/?/, "").split("/")[0] ?? "";
}

function useHashSlug(): string {
  const [slug, setSlug] = useState(currentSlug);
  useEffect(() => {
    const update = () => setSlug(currentSlug());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return slug;
}

function Home() {
  return (
    <section className="home-page">
      <div className="home-intro">
        <Badge color="green" variant="soft">
          <ShieldCheckIcon aria-hidden size={14} />
          Local-first
        </Badge>
        <Heading as="h1" size="8">
          Useful work stays on your device.
        </Heading>
        <Text as="p" color="gray" size="4">
          A focused suite for files, media, data, security, and developer tasks.
        </Text>
      </div>
      <div className="tool-grid" aria-label="Available tools">
        {tools.map((tool) => (
          <a className="tool-card" href={`#/${tool.slug}`} key={tool.slug}>
            <div>
              <Text as="p" size="3" weight="medium">
                {tool.name}
              </Text>
              <Text as="p" size="2" color="gray">
                {tool.summary}
              </Text>
            </div>
            <ArrowRightIcon aria-hidden size={18} />
          </a>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const slug = useHashSlug();
  const tool = slug ? getTool(slug) : undefined;

  return (
    <AppShell tools={tools} activeSlug={tool?.slug}>
      {!slug ? <Home /> : null}
      {slug && !tool ? (
        <EmptyState title="Tool not found" description="Choose a tool from the navigation." />
      ) : null}
      {tool ? (
        <ToolLayout tool={tool}>
          <CapabilityNotice missing={missingCapabilities(tool.capabilities ?? [])} />
          <Suspense
            fallback={
              <EmptyState title="Loading workspace" description="Preparing this local tool." />
            }
          >
            <tool.component />
          </Suspense>
        </ToolLayout>
      ) : null}
    </AppShell>
  );
}
