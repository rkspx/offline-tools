import { FileArrowUpIcon } from "@phosphor-icons/react";
import { Button, Text } from "@radix-ui/themes";
import { useRef, useState, type DragEvent } from "react";

type FileDropProps = {
  readonly accept?: string;
  readonly disabled?: boolean;
  readonly multiple?: boolean;
  readonly onFiles: (files: readonly File[]) => void;
};

export function FileDrop({
  accept,
  disabled = false,
  multiple = false,
  onFiles,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function submit(files: FileList | null) {
    if (!disabled && files?.length) onFiles(Array.from(files));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    submit(event.dataTransfer.files);
  }

  return (
    <div
      className={dragging ? "file-drop is-dragging" : "file-drop"}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <FileArrowUpIcon aria-hidden size={28} weight="duotone" />
      <div>
        <Text as="p" size="3" weight="medium">
          Drop files here
        </Text>
        <Text as="p" size="2" color="gray">
          Files stay on this device.
        </Text>
      </div>
      <Button type="button" variant="soft" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Choose files
      </Button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          submit(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
