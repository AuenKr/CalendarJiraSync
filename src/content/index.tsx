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
const FLOATING_MOUNT_POINT_ID = 'calendar-jira-sync-floating-root'
let activeContentMount: {
  host: HTMLElement
  reactRoot: ReturnType<typeof ReactDOM.createRoot>
  ownerModal: Element | null
} | null = null
const EVENT_OVERLAY_SELECTOR = '[role="dialog"], .yDmH0d, .p9lUpf, [data-viewkey="EVENTEDIT"], .XyKLOd, .A0VJ5'

function isUsableOwner(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el === document.body || el === document.documentElement) return false
  return true
}

function resolveOwnerFromTitleInput(titleInput: HTMLElement): HTMLElement | null {
  const owner = titleInput.closest(EVENT_OVERLAY_SELECTOR)
  if (isUsableOwner(owner)) return owner
  return isUsableOwner(titleInput.parentElement) ? titleInput.parentElement : null
}


chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_CALENDAR_EVENTS') {
    const events = scrapeEvents()
    sendResponse({ events })
    return false
  }

  if (message.type === 'FETCH_EVENT_DESCRIPTION') {
    const { eventId } = message.payload
    fetchEventDescription(eventId).then(description => {
      sendResponse({ description })
    })
    return true
  }

  return false
})
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

function resolveFloatingParent(ownerModal?: Element | null): HTMLElement {
  if (ownerModal instanceof HTMLElement) {
    const modalShell = ownerModal.closest('#yDmH0d, .yDmH0d, [role="dialog"]')
    if (modalShell instanceof HTMLElement) {
      return modalShell
    }
  }
  return document.body
}

function ensureFloatingMount(ownerModal?: Element | null) {
  const existing = document.getElementById(FLOATING_MOUNT_POINT_ID)
  const targetParent = resolveFloatingParent(ownerModal)

  if (existing) {
    if (existing.parentElement !== targetParent) {
      targetParent.appendChild(existing)
    }
    return
  }

  const host = document.createElement('div')
  host.id = FLOATING_MOUNT_POINT_ID
  host.style.position = 'fixed'
  host.style.left = '0'
  host.style.top = '0'
  host.style.width = '100vw'
  host.style.height = '100vh'
  host.style.zIndex = '2147483647'
  host.style.pointerEvents = 'none'
  host.style.background = 'transparent'

  targetParent.appendChild(host)
  const { shadow } = createShadowRootMount(host, 'calendar-jira-sync-floating-root')

  let popoverContainer = shadow.getElementById('popover-container')
  if (!popoverContainer) {
    popoverContainer = document.createElement('div')
    popoverContainer.id = 'popover-container'
    shadow.appendChild(popoverContainer)
  }

  popoverContainer.style.position = 'fixed'
  popoverContainer.style.left = '0'
  popoverContainer.style.top = '0'
  popoverContainer.style.width = '100vw'
  popoverContainer.style.height = '100vh'
  popoverContainer.style.pointerEvents = 'none'
  popoverContainer.style.zIndex = '2147483647'
}

function resolveOwningModal(el: Element | null): Element | null {
  if (!el) return null

  const explicitTitleInput = el instanceof HTMLInputElement && el.id === 'xTiIn'
    ? el
    : null
  const discoveredTitleInput = explicitTitleInput || (el.querySelector('#xTiIn') as HTMLInputElement | null)
  if (discoveredTitleInput instanceof HTMLElement) {
    const ownerFromTitle = resolveOwnerFromTitleInput(discoveredTitleInput)
    if (ownerFromTitle) {
      return ownerFromTitle
    }
  }

  if (el.matches(EVENT_OVERLAY_SELECTOR) && isUsableOwner(el)) return el
  const closest = el.closest(EVENT_OVERLAY_SELECTOR)
  if (isUsableOwner(closest)) return closest
  return null
}

function cleanupContentMount() {
  if (!activeContentMount) return
  try {
    activeContentMount.reactRoot.unmount()
  } catch (e) {
    console.warn('[Jira Sync][Content][Mount] unmount failed', e)
  }
  if (activeContentMount.host.isConnected) {
    activeContentMount.host.remove()
  }
  activeContentMount = null
}

function injectApp(modal: Element) {
  const currentModal = resolveOwningModal(modal)
  if (!currentModal) {
    return
  }

  ensureFloatingMount(currentModal)

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
    ? (currentModal.querySelector('[data-viewkey="EVENTEDIT"]') ||
      currentModal.querySelector('.XyKLOd') ||
      currentModal.querySelector('.A0VJ5') ||
      currentModal)
    : currentModal

  const host = document.createElement('div')
  host.id = MOUNT_POINT_ID
  // Ensure high z-index to be above Google Calendar modals
  host.style.position = 'relative'
  host.style.zIndex = '2147483647'
  // host.style.marginTop = '8px' // Removed to prevent layout issues with date field

  // Try to find the title input to inject after it
  // Google Calendar classes are obfuscated, so we look for structure or aria-labels
  let titleInput = resolveVisibleTitleInput(lookupRoot)

  // Check if modal itself is the input (e.g. if observer passed the input directly)
  if (!titleInput && currentModal instanceof HTMLInputElement) {
    if (currentModal.id === 'xTiIn' || 
        currentModal.getAttribute('aria-label') === 'Add title' || 
        currentModal.getAttribute('aria-label') === 'Title') {
      if (isVisibleInput(currentModal)) {
        titleInput = currentModal
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

  if (activeContentMount) {
    const sameModal = activeContentMount.ownerModal === currentModal
    const hostConnected = activeContentMount.host.isConnected
    if (sameModal && hostConnected) {
      return
    }
    cleanupContentMount()
  }

  const existingHosts = Array.from(document.querySelectorAll(`#${MOUNT_POINT_ID}`))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)

  if (existingHosts.length > 0) {
    const belongsToModal = (host: HTMLElement) => {
      if (currentModal.contains(host)) return true
      const owner = host.closest(EVENT_OVERLAY_SELECTOR)
      return owner === currentModal
    }

    const sameModalHost = existingHosts.find(host => belongsToModal(host))
    if (sameModalHost) {
      return
    }

    // Clean up stale/duplicate mounts before creating a new one.
    for (const host of existingHosts) {
      host.remove()
    }
  }

  let injected = false

  if (titleInput && titleInput.parentElement) {
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
      // In full edit, title row is often a flex container. Injecting after the title input
      // block can place our warning inline with the title text. Move below the row instead.
      const parentDisplay = window.getComputedStyle(target.parentElement).display
      const shouldInjectBelowTitleRow = isEventEditView && parentDisplay.includes('flex')

      if (shouldInjectBelowTitleRow && target.parentElement.parentElement) {
        target.parentElement.insertAdjacentElement('afterend', host)
      } else {
        target.insertAdjacentElement('afterend', host)
      }
      injected = true
    } else if (titleInput.parentElement) {
      titleInput.parentElement.insertAdjacentElement('afterend', host)
      injected = true
    }
  } else if (titleElement && currentModal instanceof HTMLElement) {
      // Use a stable in-flow anchor in bubble layout to avoid geometry drift.
      const whenContent = currentModal.querySelector('#xDetDlgWhen .JEx5le, #xDetDlgWhen .bgOWSb, #xDetDlgWhen')
      const bubbleSection = currentModal.querySelector('.hMdQi, [jsname="sV9x3c"]')
      host.style.position = 'relative'
      host.style.zIndex = '2147483647'
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
    // Fallback: append to the modal content
    // Try to find the main content area
    const content = currentModal.querySelector('[role="tabpanel"]') || 
                    currentModal.querySelector('.yDmH0d') || // Common GCal class for modal content
                    currentModal.querySelector('.p9lUpf') || // Full edit page content container
                    currentModal
    
    content.appendChild(host)
  }

  const { root } = createShadowRootMount(host)

  try {
    const reactRoot = ReactDOM.createRoot(root)
    reactRoot.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ContentApp 
            titleInput={titleInput as HTMLInputElement} 
            titleElement={titleElement}
            container={currentModal as HTMLElement}
          />
        </QueryClientProvider>
      </StrictMode>
    )
    activeContentMount = {
      host,
      reactRoot,
      ownerModal: currentModal,
    }
  } catch (e) {
    console.error('[Calendar Jira Sync] Failed to mount React app', e)
  }
}

function resolveInjectionTarget(node: Element): Element | null {
  if (node.matches(EVENT_OVERLAY_SELECTOR)) return node

  if (node.id === 'xTiIn' && node instanceof HTMLElement) {
    return resolveOwnerFromTitleInput(node)
  }

  const dialog = node.closest('[role="dialog"]')
  if (dialog) return dialog

  const nestedTitleInput = node.querySelector('#xTiIn')
  if (nestedTitleInput instanceof HTMLElement) {
    const owner = resolveOwnerFromTitleInput(nestedTitleInput)
    if (owner) return owner
  }

  const resolved = node.querySelector(EVENT_OVERLAY_SELECTOR) || null

  return resolved
}

function shouldCheckForInjection(node: Element): boolean {
  if (node.matches(`${EVENT_OVERLAY_SELECTOR}, #xTiIn`)) return true
  return !!node.querySelector(`${EVENT_OVERLAY_SELECTOR}, #xTiIn`)
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

  const eventContainer = titleInput.closest(EVENT_OVERLAY_SELECTOR)
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
    return
  }

  const container = resolveCalendarContainer()
  if (!container) {
    if (existingHost) {
      existingHost.style.display = 'none'
    }
    return
  }

  if (existingHost) {
    if (existingHost.parentElement !== container) {
      container.appendChild(existingHost)
    }
    existingHost.style.display = 'block'
    updateDockPosition(existingHost, container)
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
  } catch (e) {
    console.error('[Jira Sync][Content] Failed to mount CalendarDock', e)
  }
}

ensureFloatingMount()

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

      if (activeContentMount?.host === removedMount || removedMount.contains(activeContentMount?.host || null)) {
        cleanupContentMount()
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
observer.observe(document.body, { childList: true, subtree: true })

function ensureMountOnActiveContainers() {
  const candidates = new Set<Element>()
  for (const node of document.querySelectorAll(EVENT_OVERLAY_SELECTOR)) {
    candidates.add(node)
  }
  for (const input of document.querySelectorAll('#xTiIn')) {
    if (!(input instanceof HTMLElement)) continue
    const owner = resolveOwnerFromTitleInput(input)
    if (owner) candidates.add(owner)
  }

  const hasStableActiveMount = !!(activeContentMount && activeContentMount.host.isConnected && activeContentMount.ownerModal)

  for (const candidate of candidates) {
    if (!(candidate instanceof Element)) continue
    if (hasStableActiveMount && candidate !== activeContentMount?.ownerModal) continue
    const style = window.getComputedStyle(candidate as HTMLElement)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (candidate.querySelector(`#${MOUNT_POINT_ID}`)) continue
    const hasTitleTarget = !!candidate.querySelector(
      '#xTiIn, input[aria-label="Add title"], input[aria-label="Title"], [role="heading"], .JAPzS, .gUD7Lf',
    )
    if (!hasTitleTarget) continue
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
  injectApp(existingDialog)
} else {
  // Also check for event bubble
  const bubble = document.querySelector('.yDmH0d')
  if (bubble) {
    injectApp(bubble)
  }
  
  // Check for full edit page
  const fullEdit = document.querySelector('.p9lUpf') ||
    document.querySelector('[data-viewkey="EVENTEDIT"]') ||
    document.querySelector('.XyKLOd') ||
    document.querySelector('.A0VJ5') ||
    document.querySelector('#xTiIn')?.closest(EVENT_OVERLAY_SELECTOR)
  if (fullEdit) {
    injectApp(fullEdit)
  }
}

ensureDockMount()
