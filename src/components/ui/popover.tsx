
import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"

const portalLogPrefix = "[Jira Sync][Content][Popover]"
let lastPortalDebugKey = ""

function getElementSummary(el: Element | null): string {
  if (!el) return "null"
  const id = el.id ? `#${el.id}` : ""
  const className = typeof (el as HTMLElement).className === "string"
    ? (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join(".")
    : ""
  const classPart = className ? `.${className}` : ""
  return `${el.tagName.toLowerCase()}${id}${classPart}`
}

function getStyleSnapshot(el: HTMLElement | null) {
  if (!el) return null
  const style = window.getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  return {
    position: style.position,
    zIndex: style.zIndex,
    pointerEvents: style.pointerEvents,
    overflow: style.overflow,
    opacity: style.opacity,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  }
}

function logPortalDebug(reason: string, details?: Record<string, unknown>) {
  const key = `${reason}|${details ? JSON.stringify(details) : ""}`
  if (key === lastPortalDebugKey) return
  lastPortalDebugKey = key
  if (details) {
    console.log(`${portalLogPrefix} ${reason}`, details)
    return
  }
  console.log(`${portalLogPrefix} ${reason}`)
}

function ensureShadowPopoverContainer(host: HTMLElement): HTMLElement | null {
  if (!host.shadowRoot) return null

  let container = host.shadowRoot.getElementById("popover-container")
  if (!container) {
    container = document.createElement("div")
    container.id = "popover-container"
    host.shadowRoot.appendChild(container)
  }

  container.style.position = "fixed"
  container.style.left = "0"
  container.style.top = "0"
  container.style.width = "100vw"
  container.style.height = "100vh"
  container.style.pointerEvents = "none"
  container.style.zIndex = "2147483647"

  logPortalDebug("configured shadow popover container", {
    host: getElementSummary(host),
    container: getElementSummary(container),
    containerStyle: getStyleSnapshot(container as HTMLElement),
  })

  return container as HTMLElement
}

function getPortalContainer() {
  const activeSummary = document.activeElement instanceof Element
    ? getElementSummary(document.activeElement)
    : "null"

  const floatingHost = document.getElementById("calendar-jira-sync-floating-root")
  if (floatingHost instanceof HTMLElement) {
    const container = ensureShadowPopoverContainer(floatingHost)
    if (container) {
      logPortalDebug("container resolved: floating host", {
        activeElement: activeSummary,
        host: getElementSummary(floatingHost),
        container: getElementSummary(container),
      })
      return container
    }
  }

  const activeElement = document.activeElement
  if (activeElement instanceof Element) {
    const activeHost = activeElement.closest("#calendar-jira-sync-root, #calendar-jira-sync-dock-root")
    if (activeHost instanceof HTMLElement) {
      const container = ensureShadowPopoverContainer(activeHost)
      if (container) {
        logPortalDebug("container resolved: active host", {
          activeElement: activeSummary,
          host: getElementSummary(activeHost),
          container: getElementSummary(container),
        })
        return container
      }
    }
  }

  const contentHost = document.getElementById("calendar-jira-sync-root")
  if (contentHost instanceof HTMLElement) {
    const container = ensureShadowPopoverContainer(contentHost)
    if (container) {
      logPortalDebug("container resolved: content host", {
        activeElement: activeSummary,
        host: getElementSummary(contentHost),
        container: getElementSummary(container),
      })
      return container
    }
  }

  const dockHost = document.getElementById("calendar-jira-sync-dock-root")
  if (dockHost instanceof HTMLElement) {
    const container = ensureShadowPopoverContainer(dockHost)
    if (container) {
      logPortalDebug("container resolved: dock host", {
        activeElement: activeSummary,
        host: getElementSummary(dockHost),
        container: getElementSummary(container),
      })
      return container
    }
  }

  logPortalDebug("container resolved: document.body fallback", {
    activeElement: activeSummary,
  })
  return document.body
}

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const [container, setContainer] = React.useState<HTMLElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    setContainer(getPortalContainer())
  }, [])

  React.useEffect(() => {
    if (!container) return
    const root = container.getRootNode()
    const shadowHost = root instanceof ShadowRoot ? root.host : null
    logPortalDebug("portal container snapshot", {
      container: getElementSummary(container),
      containerStyle: getStyleSnapshot(container),
      parent: getElementSummary(container.parentElement),
      shadowHost: getElementSummary(shadowHost),
      shadowHostStyle: shadowHost instanceof HTMLElement ? getStyleSnapshot(shadowHost) : null,
    })
  }, [container])

  React.useEffect(() => {
    if (!container || !contentRef.current) return
    const frame = window.requestAnimationFrame(() => {
      logPortalDebug("popover content snapshot", {
        content: getElementSummary(contentRef.current),
        contentStyle: getStyleSnapshot(contentRef.current),
        contentParent: getElementSummary(contentRef.current?.parentElement || null),
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [container])

  React.useEffect(() => {
    if (!contentRef.current) return

    const stopCalendarOutsideHandlers = (event: Event) => {
      const content = contentRef.current
      if (!content) return

      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      const target = event.target
      const isInsidePopover = path.includes(content) || (target instanceof Node && content.contains(target))
      if (!isInsidePopover) return

      event.stopPropagation()
    }

    window.addEventListener('pointerdown', stopCalendarOutsideHandlers, true)
    window.addEventListener('mousedown', stopCalendarOutsideHandlers, true)
    window.addEventListener('click', stopCalendarOutsideHandlers, true)

    return () => {
      window.removeEventListener('pointerdown', stopCalendarOutsideHandlers, true)
      window.removeEventListener('mousedown', stopCalendarOutsideHandlers, true)
      window.removeEventListener('click', stopCalendarOutsideHandlers, true)
    }
  }, [container])

  if (!container) return null

  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        ref={(node) => {
          contentRef.current = node
          if (!ref) return
          if (typeof ref === "function") {
            ref(node)
            return
          }
          ref.current = node
        }}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "pointer-events-auto bg-popover text-popover-foreground z-[2147483647] w-72 rounded-md border p-4 shadow-md outline-hidden",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
          "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
