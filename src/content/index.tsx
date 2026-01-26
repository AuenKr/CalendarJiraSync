import ReactDOM from 'react-dom/client'
import { StrictMode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import ContentApp from './ContentApp'
import { scrapeEvents, fetchEventDescription } from './scraper'
import styles from '../index.css?inline'

const MOUNT_POINT_ID = 'calendar-jira-sync-root'

// console.log('[Calendar Jira Sync] Content script loaded')

function injectApp(modal: Element) {
  // console.log('[Calendar Jira Sync] Attempting to inject into modal', modal)

  if (modal.querySelector(`#${MOUNT_POINT_ID}`)) {
    // console.log('[Calendar Jira Sync] Already injected')
    return
  }

  const host = document.createElement('div')
  host.id = MOUNT_POINT_ID
  // Ensure high z-index to be above Google Calendar modals
  host.style.position = 'relative'
  host.style.zIndex = '9999'
  host.style.marginTop = '8px' // Add some spacing

  // Try to find the title input to inject after it
  // Google Calendar classes are obfuscated, so we look for structure or aria-labels
  const titleInput = modal.querySelector('input[aria-label="Add title"]') || 
                     modal.querySelector('input[aria-label="Title"]') ||
                     modal.querySelector('input[type="text"]') ||
                     modal.querySelector('#xTiIn') // Full edit page title input ID

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
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_CALENDAR_EVENTS') {
    // console.log('[Calendar Jira Sync] Received request to scrape events')
    const events = scrapeEvents()
    // console.log('[Calendar Jira Sync] Scraped events:', events)
    sendResponse({ events })
  } else if (message.type === 'FETCH_EVENT_DESCRIPTION') {
    const { eventId } = message.payload
    fetchEventDescription(eventId).then(description => {
      sendResponse({ description })
    })
    return true // Async response
  }
  return true // Keep channel open for async response if needed (though we respond synchronously here)
})

  
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

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.appendChild(style)

  const root = document.createElement('div')
  // Add a class to the root for scoping if needed
  root.className = 'calendar-jira-sync-root'
  shadow.appendChild(root)

  try {
    ReactDOM.createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ContentApp titleInput={titleInput as HTMLInputElement} />
        </QueryClientProvider>
      </StrictMode>
    )
    // console.log('[Calendar Jira Sync] React app mounted')
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
          }
          
          // Also check for the "event edit" container which might not be a dialog in some views
          // Class 'yDmH0d' is often used for the event bubble
          if (node.classList.contains('yDmH0d') || node.querySelector('.yDmH0d')) {
             // console.log('[Calendar Jira Sync] Detected event bubble', node)
             injectApp(node)
          }
          
          // Check for full page edit container
          if (node.querySelector('#xTiIn') || node.querySelector('.p9lUpf')) {
             // console.log('[Calendar Jira Sync] Detected full edit page', node)
             injectApp(node)
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

