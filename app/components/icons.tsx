// ── Jeelo Icon Library ─────────────────────────────────────────
// Clean SVG icons at 20×20 default. All icons accept className + size props.

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const defaults = { size: 18, strokeWidth: 1.7 };

// Wrapper for consistent icon output
function Icon({ size = defaults.size, className, strokeWidth = defaults.strokeWidth, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconLibrary(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 3h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M7 7h4M7 10h4M7 13h2" />
      <path d="M14 6h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6" />
    </Icon>
  );
}

export function IconTests(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M7 7h6M7 10h6M7 13h3" />
    </Icon>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 11l8-4 8 4-8 4-8-4Z" />
      <path d="M2 7.5l8-4 8 4" />
      <path d="M2 14.5l8 4 8-4" />
    </Icon>
  );
}

export function IconDiscover(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M12.5 7.5l-2 4.5-4.5 2 2-4.5 4.5-2Z" />
    </Icon>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5a1 1 0 0 1 .98.8l.22 1.1a6 6 0 0 1 1.2.7l1.07-.43a1 1 0 0 1 1.23.46l.5.87a1 1 0 0 1-.23 1.27l-.87.7a6.1 6.1 0 0 1 0 1.4l.87.7a1 1 0 0 1 .23 1.27l-.5.87a1 1 0 0 1-1.23.46l-1.07-.43a6 6 0 0 1-1.2.7l-.22 1.1A1 1 0 0 1 10 17.5a1 1 0 0 1-.98-.8l-.22-1.1a6 6 0 0 1-1.2-.7l-1.07.43a1 1 0 0 1-1.23-.46l-.5-.87a1 1 0 0 1 .23-1.27l.87-.7a6.1 6.1 0 0 1 0-1.4l-.87-.7a1 1 0 0 1-.23-1.27l.5-.87a1 1 0 0 1 1.23-.46l1.07.43a6 6 0 0 1 1.2-.7l.22-1.1A1 1 0 0 1 10 2.5z" />
    </Icon>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="6.5" r="3" />
      <path d="M3.5 17c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
    </Icon>
  );
}

export function IconSignOut(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 5h2.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H13" />
      <path d="M9 13l4-3-4-3" />
      <path d="M4 10h9" />
    </Icon>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
    </Icon>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17 12.5A7 7 0 0 1 7.5 3a7 7 0 1 0 9.5 9.5Z" />
    </Icon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 4v12M4 10h12" />
    </Icon>
  );
}

export function IconDotsVertical(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </Icon>
  );
}

export function IconFolderOpen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v1H3V7Z" />
      <path d="M3 10h14l-1.5 6H4.5L3 10Z" />
    </Icon>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 2.5a2.12 2.12 0 0 1 3 3L6 17H2v-4L14.5 2.5Z" />
    </Icon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5h14M8 5V3h4v2M6 5l.75 12h6.5L14 5" />
    </Icon>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" />
    </Icon>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4l6 6-6 6" />
    </Icon>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 4l-6 6 6 6" />
    </Icon>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7l6 6 6-6" />
    </Icon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 10l5 5 9-9" />
    </Icon>
  );
}

export function IconX(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4l12 12M16 4L4 16" />
    </Icon>
  );
}

export function IconEye(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 10s3.5-6 8-6 8 6 8 6-3.5 6-8 6-8-6-8-6Z" />
      <circle cx="10" cy="10" r="2.5" />
    </Icon>
  );
}

export function IconEyeOff(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3l14 14M10.5 5.1A8.2 8.2 0 0 1 18 10s-.7 1.4-2 2.7M6.3 6.3C4.3 7.6 2 10 2 10s3.5 6 8 6a8 8 0 0 0 3.7-.9" />
      <path d="M8 9.4A2.5 2.5 0 0 0 12.6 12" />
    </Icon>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 10H4M9 5l-5 5 5 5" />
    </Icon>
  );
}

export function IconTrophy(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 2h8v8a4 4 0 0 1-8 0V2Z" />
      <path d="M6 5H3v2a3 3 0 0 0 3 3M14 5h3v2a3 3 0 0 1-3 3" />
      <path d="M10 14v3M7 18h6" />
    </Icon>
  );
}

export function IconBookOpen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 4a2 2 0 0 1 2-2h5v16H4a2 2 0 0 1-2-2V4ZM18 4a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 0 2-2V4Z" />
    </Icon>
  );
}

export function IconShare(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="15" cy="5" r="2" />
      <circle cx="5" cy="10" r="2" />
      <circle cx="15" cy="15" r="2" />
      <path d="M7 9l6-3M7 11l6 3" />
    </Icon>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 4l12 6-12 6V4Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconFlash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 2L4 11h6l-1 7 7-9h-6l1-7Z" />
    </Icon>
  );
}

export function IconTarget(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconGraph(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 15l4-5 3 3 4-6 3 3" />
      <path d="M3 17h14" />
    </Icon>
  );
}
