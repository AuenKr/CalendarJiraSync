import ReactDOM from 'react-dom/client'
import { StrictMode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import ContentApp from './ContentApp'
import CalendarDock from './CalendarDock'
import { scrapeEvents, fetchEventDescription } from './scraper'
import styles from '../index.css?inline'

const MOUNT_POINT_ID = 'calendar-jira-sync-root'
const DOCK_MOUNT_POINT_ID = 'calendar-jira-sync-dock-root'
const logPrefix = '[Jira Sync][Content][Dock]'
let lastDockDebugKey = ''

// console.log('[Calendar Jira Sync] Content script loaded')

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_CALENDAR_EVENTS') {
    console.log('[Jira Sync][Content] Received FETCH_CALENDAR_EVENTS')
    const events = scrapeEvents()
    console.log('[Jira Sync][Content] Returning scraped events', { count: events.length })
    sendResponse({ events })
    return false
  }

  if (message.type === 'FETCH_EVENT_DESCRIPTION') {
    const { eventId } = message.payload
    console.log('[Jira Sync][Content] Received FETCH_EVENT_DESCRIPTION', { eventId })
    fetchEventDescription(eventId).then(description => {
      console.log('[Jira Sync][Content] Returning event description', { eventId, hasDescription: !!description })
      sendResponse({ description })
    })
    return true
  }

  return false
})

function logDockDebug(reason: string, details?: Record<string, unknown>) {
  const detailText = details ? JSON.stringify(details) : ''
  const key = `${reason}|${detailText}`
  if (key === lastDockDebugKey) return
  lastDockDebugKey = key
  if (details) {
    console.log(`${logPrefix} ${reason}`, details)
  } else {
    console.log(`${logPrefix} ${reason}`)
  }
}

function applyThemeToElement(element: Element) {
  const bodyBg = window.getComputedStyle(document.body).backgroundColor
  const isDark = bodyBg.match(/\d+/g)?.some(c => parseInt(c) < 100)

  if (isDark) {
    element.classList.add('dark')
  } else {
    element.classList.remove('dark')
  }
}

function createShadowRootMount(host: HTMLElement, rootClassName = 'calendar-jira-sync-root'): { shadow: ShadowRoot, root: HTMLDivElement } {
  host.style.background = 'transparent'
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = styles
  shadow.appendChild(style)

  const root = document.createElement('div')
  root.className = rootClassName
  root.style.background = 'transparent'
  applyThemeToElement(root)
  shadow.appendChild(root)

  const themeObserver = new MutationObserver(() => {
    applyThemeToElement(root)
    const popoverContainer = shadow.getElementById('popover-container')
    if (popoverContainer) {
      applyThemeToElement(popoverContainer)
    }
    const dialogContainer = shadow.getElementById('dialog-container')
    if (dialogContainer) {
      applyThemeToElement(dialogContainer)
    }
  })
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] })

  const shadowObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.id === 'popover-container' || node.id === 'dialog-container') {
          applyThemeToElement(node)
        }
      }
    }
  })
  shadowObserver.observe(shadow, { childList: true })

  return { shadow, root }
}

function injectApp(modal: Element) {
  if (modal.querySelector(`#${MOUNT_POINT_ID}`)) {
    return
  }

  const keyPattern = /\b[A-Z][A-Z0-9]+-\d+\b/

  const isVisibleInput = (node: HTMLInputElement): boolean => {
    const style = window.getComputedStyle(node)
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0
  }

  const resolveVisibleTitleInput = (root: ParentNode): HTMLInputElement | null => {
    const selectors = [
      'input[aria-label="Add title"]',
      'input[aria-label="Title"]',
      'input[aria-label*="title" i]',
      '#xTiIn',
    ]
    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector)
      for (const node of nodes) {
        if (!(node instanceof HTMLInputElement)) continue
        if (isVisibleInput(node)) return node
      }
    }
    return null
  }

  const resolveVisibleTitleElement = (root: ParentNode): HTMLElement | undefined => {
    const selectors = ['[role="heading"]', '.JAPzS', '.gUD7Lf']
    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector)
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue
        const style = window.getComputedStyle(node)
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0
        if (!visible) continue
        const text = (node.textContent || '').trim()
        if (!text) continue
        if (keyPattern.test(text)) {
          return node
        }
      }
    }
    return undefined
  }

  const isEventEditView = document.body.getAttribute('data-viewfamily') === 'EVENT_EDIT'
  const lookupRoot = isEventEditView
    ? (modal.querySelector('[data-viewkey="EVENTEDIT"]') ||
      modal.querySelector('.XyKLOd') ||
      modal.querySelector('.A0VJ5') ||
      modal)
    : modal

  const host = document.createElement('div')
  host.id = MOUNT_POINT_ID
  // Ensure high z-index to be above Google Calendar modals
  host.style.position = 'relative'
  host.style.zIndex = '9999'
  // host.style.marginTop = '8px' // Removed to prevent layout issues with date field

  // Try to find the title input to inject after it
  // Google Calendar classes are obfuscated, so we look for structure or aria-labels
  let titleInput = resolveVisibleTitleInput(lookupRoot)

  // Check if modal itself is the input (e.g. if observer passed the input directly)
  if (!titleInput && modal instanceof HTMLInputElement) {
    if (modal.id === 'xTiIn' || 
        modal.getAttribute('aria-label') === 'Add title' || 
        modal.getAttribute('aria-label') === 'Title') {
      if (isVisibleInput(modal)) {
        titleInput = modal
      }
    }
  }

  let titleElement: HTMLElement | undefined
  if (!titleInput) {
     titleElement = resolveVisibleTitleElement(lookupRoot)
  }

  if (!titleInput && !titleElement) {
    return
  }

  let injected = false

  if (titleInput && titleInput.parentElement) {
    // console.log('[Calendar Jira Sync] Found title input', titleInput)
    // Go up a few levels if needed to find a block container
    // Google Calendar inputs are usually wrapped in a few divs.
    // We want to be inside the main form container to avoid being treated as "outside"
    let target = titleInput.parentElement
    
    // Try to find a stable container that isn't just a wrapper for the input
    // We look for a parent that has siblings, suggesting it's part of a list of form fields
    let attempts = 0
    while (target && target.parentElement && attempts < 5) {
      if (target.parentElement.getAttribute('role') === 'tabpanel') {
        break
      }
      // If the parent has multiple children, it might be the form container
      if (target.parentElement.children.length > 1) {
         // But we don't want to go too high up
      }
      
      // Heuristic: if the current target is a DIV and has a class, it might be a good place
      // But let's stick to "after the title input block"
      
      // If we find a grid or flex container, that's usually the form layout
      const style = window.getComputedStyle(target.parentElement)
      if (style.display === 'grid' || style.display === 'flex') {
        // This is likely the form container
        break
      }

      target = target.parentElement
      attempts++
    }

    if (target && target.parentElement) {
      // console.log('[Calendar Jira Sync] Injecting after target', target)
      target.insertAdjacentElement('afterend', host)
      injected = true
    } else if (titleInput.parentElement) {
      // console.log('[Calendar Jira Sync] Fallback: Injecting after title input parent')
      titleInput.parentElement.insertAdjacentElement('afterend', host)
      injected = true
    }
  } else if (titleElement && modal instanceof HTMLElement) {
      // Use a stable in-flow anchor in bubble layout to avoid geometry drift.
      const whenContent = modal.querySelector('#xDetDlgWhen .JEx5le, #xDetDlgWhen .bgOWSb, #xDetDlgWhen')
      const bubbleSection = modal.querySelector('.hMdQi, [jsname="sV9x3c"]')
      host.style.position = 'relative'
      host.style.zIndex = '10000'
      host.style.marginTop = '6px'
      host.style.marginBottom = '2px'

      if (whenContent instanceof HTMLElement) {
        whenContent.appendChild(host)
        injected = true
      } else if (bubbleSection instanceof HTMLElement) {
        const firstRow = bubbleSection.firstElementChild
        if (firstRow instanceof HTMLElement) {
          firstRow.insertAdjacentElement('afterend', host)
        } else {
          bubbleSection.appendChild(host)
        }
        injected = true
      } else {
        titleElement.insertAdjacentElement('afterend', host)
        injected = true
      }
  }

  if (!injected) {
    // console.log('[Calendar Jira Sync] Title input not found or injection failed. Trying generic append.')
    // Fallback: append to the modal content
    // Try to find the main content area
    const content = modal.querySelector('[role="tabpanel"]') || 
                    modal.querySelector('.yDmH0d') || // Common GCal class for modal content
                    modal.querySelector('.p9lUpf') || // Full edit page content container
                    modal
    
    // console.log('[Calendar Jira Sync] Appending to content', content)
    content.appendChild(host)
  }

  const { root } = createShadowRootMount(host)

  try {
    ReactDOM.createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ContentApp 
            titleInput={titleInput as HTMLInputElement} 
            titleElement={titleElement}
            container={modal as HTMLElement}
          />
        </QueryClientProvider>
      </StrictMode>
    )
    console.log('[Jira Sync][Content] ContentApp mounted')
  } catch (e) {
    console.error('[Calendar Jira Sync] Failed to mount React app', e)
  }
}

function resolveInjectionTarget(node: Element): Element | null {
  if (node.matches('[role="dialog"], .yDmH0d, .p9lUpf')) return node

  if (node.id === 'xTiIn' && node.parentElement) {
    return node.parentElement
  }

  const dialog = node.closest('[role="dialog"]')
  if (dialog) return dialog

  return node.querySelector('[role="dialog"], .yDmH0d, .p9lUpf') ||
    node.querySelector('#xTiIn')?.parentElement ||
    null
}

function shouldCheckForInjection(node: Element): boolean {
  if (node.matches('[role="dialog"], .yDmH0d, .p9lUpf, #xTiIn')) return true
  return !!node.querySelector('[role="dialog"], .yDmH0d, .p9lUpf, #xTiIn')
}

function isVisibleElement(el: Element): boolean {
  const style = window.getComputedStyle(el as HTMLElement)
  return style.display !== 'none' && style.visibility !== 'hidden' && (el as HTMLElement).getClientRects().length > 0
}

function hasOpenEventOverlay(): boolean {
  if (document.body.getAttribute('data-viewfamily') === 'EVENT_EDIT') return true

  // Keep this strict to avoid false positives from unrelated Google Calendar dialogs.
  const titleInput = document.querySelector('#xTiIn, input[aria-label="Add title"], input[aria-label="Title"]')
  if (!(titleInput instanceof HTMLElement) || !isVisibleElement(titleInput)) {
    return false
  }

  const eventContainer = titleInput.closest('[role="dialog"], .p9lUpf, .yDmH0d')
  return !!eventContainer && isVisibleElement(eventContainer)
}

function resolveCalendarContainer(): HTMLElement | null {
  const main = document.querySelector('[role="main"]')
  if (main instanceof HTMLElement && isVisibleElement(main)) {
    return main
  }

  const fallbackSelectors = [
    '[data-viewkey="DAY"]',
    '[data-viewkey="WEEK"]',
    '[data-viewkey="MONTH"]',
    '[data-viewkey="SCHEDULE"]',
    '[role="grid"]',
  ]

  let best: HTMLElement | null = null
  let bestArea = 0

  for (const selector of fallbackSelectors) {
    const nodes = document.querySelectorAll(selector)
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue
      if (node.closest('[role="dialog"]')) continue
      if (!isVisibleElement(node)) continue

      const container = (node.closest('[role="main"]') || node.parentElement || node) as HTMLElement
      const rect = container.getBoundingClientRect()
      const area = rect.width * rect.height

      if (area > bestArea) {
        best = container
        bestArea = area
      }
    }
  }

  return best
}

function updateDockPosition(host: HTMLElement, container: HTMLElement) {
  if (window.getComputedStyle(container).position === 'static') {
    container.style.position = 'relative'
  }

  host.style.position = 'absolute'
  host.style.zIndex = '2147483000'
  host.style.right = '24px'
  host.style.bottom = '24px'
  host.style.left = 'auto'
  host.style.top = 'auto'
  host.style.pointerEvents = 'auto'
}

function ensureDockMount() {
  const existingHost = document.getElementById(DOCK_MOUNT_POINT_ID) as HTMLElement | null

  if (hasOpenEventOverlay()) {
    if (existingHost) {
      existingHost.style.display = 'none'
    }
    logDockDebug('hidden: event overlay open')
    return
  }

  const container = resolveCalendarContainer()
  if (!container) {
    if (existingHost) {
      existingHost.style.display = 'none'
    }
    logDockDebug('hidden: no calendar container resolved')
    return
  }

  if (existingHost) {
    if (existingHost.parentElement !== container) {
      container.appendChild(existingHost)
    }
    existingHost.style.display = 'block'
    updateDockPosition(existingHost, container)
    const rect = container.getBoundingClientRect()
    const hostRect = existingHost.getBoundingClientRect()
    logDockDebug('shown: reused existing dock host', {
      containerWidth: Math.round(rect.width),
      containerHeight: Math.round(rect.height),
      hostX: Math.round(hostRect.x),
      hostY: Math.round(hostRect.y),
      hostWidth: Math.round(hostRect.width),
      hostHeight: Math.round(hostRect.height),
      hostZ: existingHost.style.zIndex,
    })
    return
  }

  const host = document.createElement('div')
  host.id = DOCK_MOUNT_POINT_ID
  host.style.background = 'transparent'
  updateDockPosition(host, container)
  container.appendChild(host)

  const { root } = createShadowRootMount(host, 'calendar-jira-sync-dock-root')

  try {
    ReactDOM.createRoot(root).render(
      <StrictMode>
        <CalendarDock />
      </StrictMode>
    )
    const rect = container.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    logDockDebug('shown: mounted dock host', {
      containerWidth: Math.round(rect.width),
      containerHeight: Math.round(rect.height),
      hostX: Math.round(hostRect.x),
      hostY: Math.round(hostRect.y),
      hostWidth: Math.round(hostRect.width),
      hostHeight: Math.round(hostRect.height),
      hostZ: host.style.zIndex,
    })
  } catch (e) {
    console.error('[Jira Sync][Content] Failed to mount CalendarDock', e)
  }
}

const observer = new MutationObserver((mutations) => {
  let shouldRefreshDock = false
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        shouldRefreshDock = true
        if (!shouldCheckForInjection(node)) {
          continue
        }
        const target = resolveInjectionTarget(node)
        if (target) {
          injectApp(target)
        }
      }
    }

    for (const node of mutation.removedNodes) {
      if (!(node instanceof Element)) continue
      const removedMount = node.id === MOUNT_POINT_ID ? node : node.querySelector(`#${MOUNT_POINT_ID}`)
      if (!removedMount) continue

      const target = mutation.target instanceof Element
        ? resolveInjectionTarget(mutation.target)
        : null
      if (target) {
        console.log('[Jira Sync][Content] Detected removed mount, reinjecting', {
          role: target.getAttribute('role') || 'none',
        })
        injectApp(target)
      }
    }

    for (const node of mutation.removedNodes) {
      if (!(node instanceof Element)) continue
      const removedDock = node.id === DOCK_MOUNT_POINT_ID ? node : node.querySelector(`#${DOCK_MOUNT_POINT_ID}`)
      if (removedDock) {
        shouldRefreshDock = true
      }
    }
  }

  if (shouldRefreshDock) {
    ensureDockMount()
  }
})

// Start observing
// console.log('[Calendar Jira Sync] Starting observer')
observer.observe(document.body, { childList: true, subtree: true })

function ensureMountOnActiveContainers() {
  const candidates = [
    ...Array.from(document.querySelectorAll('[role="dialog"]')),
    ...Array.from(document.querySelectorAll('.yDmH0d')),
  ]

  for (const candidate of candidates) {
    if (!(candidate instanceof Element)) continue
    const style = window.getComputedStyle(candidate as HTMLElement)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (candidate.querySelector(`#${MOUNT_POINT_ID}`)) continue
    injectApp(candidate)
  }

  ensureDockMount()
}

const mountHealthInterval = window.setInterval(ensureMountOnActiveContainers, 1500)
const handleViewportDockRefresh = () => ensureDockMount()
window.addEventListener('resize', handleViewportDockRefresh)
window.addEventListener('scroll', handleViewportDockRefresh, true)
window.addEventListener('beforeunload', () => {
  window.clearInterval(mountHealthInterval)
  window.removeEventListener('resize', handleViewportDockRefresh)
  window.removeEventListener('scroll', handleViewportDockRefresh, true)
}, { once: true })

// Check if dialog is already open (e.g. on reload)
const existingDialog = document.querySelector('[role="dialog"]')
if (existingDialog) {
  // console.log('[Calendar Jira Sync] Found existing dialog')
  injectApp(existingDialog)
} else {
  // Also check for event bubble
  const bubble = document.querySelector('.yDmH0d')
  if (bubble) {
    // console.log('[Calendar Jira Sync] Found existing event bubble')
    injectApp(bubble)
  }
  
  // Check for full edit page
  const fullEdit = document.querySelector('.p9lUpf') || document.querySelector('#xTiIn')?.closest('.p9lUpf')
  if (fullEdit) {
    // console.log('[Calendar Jira Sync] Found existing full edit page')
    injectApp(fullEdit)
  }
}

ensureDockMount()
