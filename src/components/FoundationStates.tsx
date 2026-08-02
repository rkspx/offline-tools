import { InfoIcon, WarningCircleIcon, WrenchIcon } from "@phosphor-icons/react";
import { Callout, Heading, Text } from "@radix-ui/themes";
import type { Capability } from "../types/tool";

type EmptyStateProps = {
  readonly title: string;
  readonly description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="state-panel">
      <WrenchIcon aria-hidden size={28} weight="duotone" />
      <Heading as="h2" size="4">
        {title}
      </Heading>
      <Text as="p" color="gray" size="2">
        {description}
      </Text>
    </div>
  );
}

export function ErrorState({ message }: { readonly message: string }) {
  return (
    <Callout.Root color="red" role="alert">
      <Callout.Icon>
        <WarningCircleIcon aria-hidden />
      </Callout.Icon>
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  );
}

const capabilityLabels: Record<Capability, string> = {
  crossOriginIsolated: "cross-origin isolation",
  fileSystemAccess: "the File System Access API",
  webCodecs: "WebCodecs",
  webGpu: "WebGPU",
};

export function CapabilityNotice({ missing }: { readonly missing: readonly Capability[] }) {
  if (missing.length === 0) return null;
  const labels = missing.map((capability) => capabilityLabels[capability]).join(", ");

  return (
    <Callout.Root color="amber" role="status">
      <Callout.Icon>
        <InfoIcon aria-hidden />
      </Callout.Icon>
      <Callout.Text>This browser is missing required support: {labels}.</Callout.Text>
    </Callout.Root>
  );
}
