import ReactDOM from 'react-dom/client'
import { StrictMode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import ContentApp from './ContentApp'
import { scrapeEvents, fetchEventDescription } from './scraper'
import styles from '../index.css?inline'

const MOUNT_POINT_ID = 'calendar-jira-sync-root'

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

function applyThemeToElement(element: Element) {
  const bodyBg = window.getComputedStyle(document.body).backgroundColor
  const isDark = bodyBg.match(/\d+/g)?.some(c => parseInt(c) < 100)

  if (isDark) {
    element.classList.add('dark')
  } else {
    element.classList.remove('dark')
  }
}

function createShadowRootMount(host: HTMLElement): { shadow: ShadowRoot, root: HTMLDivElement } {
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = styles
  shadow.appendChild(style)

  const root = document.createElement('div')
  root.className = 'calendar-jira-sync-root'
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
  console.log('[Jira Sync][Content] injectApp called', { role: modal.getAttribute('role') || 'none' })

  if (modal.querySelector(`#${MOUNT_POINT_ID}`)) {
    console.log('[Jira Sync][Content] injectApp skipped: already injected in modal')
    return
  }

  const resolveVisibleTitleInput = (root: ParentNode): HTMLInputElement | null => {
    const selectors = [
      'input[aria-label="Add title"]',
      'input[aria-label="Title"]',
      '#xTiIn',
    ]
    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector)
      for (const node of nodes) {
        if (!(node instanceof HTMLInputElement)) continue
        const style = window.getComputedStyle(node)
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0
        if (visible) return node
      }
    }
    return null
  }

  const resolveVisibleTitleElement = (root: ParentNode): HTMLElement | undefined => {
    const selectors = ['[role="heading"]', '.JAPzS', '.gUD7Lf']
    const keyPattern = /\b[A-Z][A-Z0-9]+-\d+\b/
    const matches: HTMLElement[] = []
    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector)
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue
        const style = window.getComputedStyle(node)
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0
        if (!visible) continue
        const text = (node.textContent || '').trim()
        if (!text) continue
        matches.push(node)
        if (keyPattern.test(text)) {
          return node
        }
      }
    }
    return matches[0]
  }

  const host = document.createElement('div')
  host.id = MOUNT_POINT_ID
  // Ensure high z-index to be above Google Calendar modals
  host.style.position = 'relative'
  host.style.zIndex = '9999'
  // host.style.marginTop = '8px' // Removed to prevent layout issues with date field

  // Try to find the title input to inject after it
  // Google Calendar classes are obfuscated, so we look for structure or aria-labels
  let titleInput = resolveVisibleTitleInput(modal)

  // Check if modal itself is the input (e.g. if observer passed the input directly)
  if (!titleInput && modal instanceof HTMLInputElement) {
    if (modal.id === 'xTiIn' || 
        modal.getAttribute('aria-label') === 'Add title' || 
        modal.getAttribute('aria-label') === 'Title') {
      const style = window.getComputedStyle(modal)
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && modal.getClientRects().length > 0
      if (visible) {
        titleInput = modal
      }
    }
  }

  let titleElement: HTMLElement | undefined
  if (!titleInput) {
     titleElement = resolveVisibleTitleElement(modal)
  }

  if (!titleInput && !titleElement) {
    console.log('[Jira Sync][Content] injectApp skipped: no title input/element found')
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
  } else if (titleElement && titleElement.parentElement) {
      // Inject after title element for Bubble view
      // console.log('[Calendar Jira Sync] Found title element', titleElement)
      host.style.position = 'absolute'
      host.style.top = '16px'
      host.style.right = '60px'
      host.style.zIndex = '10000'
      modal.appendChild(host)
      injected = true
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

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        // Check for dialog role
        if (node.getAttribute('role') === 'dialog') {
          // console.log('[Calendar Jira Sync] Detected new dialog', node)
          injectApp(node)
        } else {
          const dialog = node.querySelector('[role="dialog"]')
          if (dialog) {
            // console.log('[Calendar Jira Sync] Detected dialog inside added node', dialog)
            injectApp(dialog)
            return // Found a dialog, stop checking this node
          }
          
          // Also check for the "event edit" container which might not be a dialog in some views
          // Class 'yDmH0d' is often used for the event bubble
          if (node.classList.contains('yDmH0d')) {
             injectApp(node)
             return
          }
          const bubble = node.querySelector('.yDmH0d')
          if (bubble) {
             injectApp(bubble)
             return
          }
          
          // Check for full page edit container
          if (node.id === 'xTiIn') {
             // If we found the input directly, pass its parent
             if (node.parentElement) injectApp(node.parentElement)
             return
          }
          if (node.classList.contains('p9lUpf')) {
             injectApp(node)
             return
          }
          const fullEdit = node.querySelector('#xTiIn') || node.querySelector('.p9lUpf')
          if (fullEdit) {
             injectApp(fullEdit)
             return
          }
        }
      }
    }
  }
})

// Start observing
// console.log('[Calendar Jira Sync] Starting observer')
observer.observe(document.body, { childList: true, subtree: true })

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
