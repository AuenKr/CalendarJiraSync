import type { CalendarEvent } from '../types/messages'

export const scrapeEvents = (): CalendarEvent[] => {
  // const events: CalendarEvent[] = []
  
  // Select all elements with data-eventid
  // This is more stable than role="button" which might vary
  const eventElements = document.querySelectorAll('div[data-eventid]')
  
  // console.log('[Jira Sync] Found event candidates:', eventElements.length)

  // Regex to match "10am to 11am, Title"
  // Captures: 1=Start, 2=End, 3=Title
  const timePattern = /^(.+?)\s+to\s+(.+?),\s+(.+?)(?:,|$)/i

  // Deduplicate events by ID
  const uniqueEvents = new Map<string, CalendarEvent>()
  
  eventElements.forEach(el => {
    let text = el.getAttribute('aria-label')
    // let source = 'aria-label'

    // Fallback: Look for a child containing the pattern
    if (!text) {
      // Traverse all descendants to find one matching the time pattern
      // We use a tree walker or just querySelectorAll('*') for simplicity on small subtrees
      const descendants = el.querySelectorAll('*')
      for (const child of descendants) {
        const childText = child.textContent || ''
        if (timePattern.test(childText)) {
          text = childText
          // source = 'child-text-pattern'
          break
        }
      }
    }

    if (!text) {
        // console.log('[Jira Sync] Could not find text for element', el)
        return
    }

    const match = text.match(timePattern)
    
    if (match) {
      const [, startStr, endStr, titlePart] = match
      const title = titlePart.trim()
      
      // Try to extract date from the end of the string
      // Format: "..., January 25, 2026"
      const dateMatch = text.match(/,\s+([A-Z][a-z]+ \d{1,2}, \d{4})$/)
      const dateStr = dateMatch ? dateMatch[1] : undefined

      // Parse times
      const startTime = parseTime(startStr, dateStr)
      const endTime = parseTime(endStr, dateStr)
      
      if (startTime && endTime) {
        const durationSeconds = (endTime.getTime() - startTime.getTime()) / 1000
        
        if (durationSeconds > 0) {
          const id = el.getAttribute('data-eventid') || undefined
          if (id && !uniqueEvents.has(id)) {
             // console.log(`[Jira Sync] Scraped: "${title}" (${durationSeconds}s) [Source: ${source}]`)
             uniqueEvents.set(id, {
               id,
               title,
               startTime: startTime.toISOString(),
               endTime: endTime.toISOString()
             })
          }
        }
      }
    }
  })

  return Array.from(uniqueEvents.values())
}

export const fetchEventDescription = async (eventId: string): Promise<string | undefined> => {
  try {
    // Decode the event ID if it looks like base64 (common in GCal)
    // Actually, the data-eventid is usually the "eid" parameter which works directly in the URL
    // URL format: https://calendar.google.com/calendar/u/0/r/eventedit/{eid}
    
    const url = `https://calendar.google.com/calendar/u/0/r/eventedit/${eventId}`
    // console.log(`[Jira Sync] Fetching description from: ${url}`)
    
    const response = await fetch(url)
    const html = await response.text()
    
    // Parse the HTML to find the description
    // Google Calendar edit page usually puts the description in a textarea or a JS variable
    // We look for the textarea with aria-label="Description" or similar structure
    
    // Strategy 1: Look for the textarea content
    // <textarea ... aria-label="Description">THE DESCRIPTION</textarea>
    // Note: The HTML might be minified or rendered via JS, so simple regex is safer than DOM parsing for raw HTML string
    
    // This regex looks for the description field value in the initial data payload often found in scripts
    // or directly in the textarea if server-rendered.
    // However, GCal is heavy JS. The most reliable way without executing JS is to look for the data pattern.
    // But let's try a simpler approach first: The description is often in the "desc" parameter of the data array.
    
    // Let's try to find the textarea first as it's the most standard
    const textAreaMatch = html.match(/<textarea[^>]*aria-label="Description"[^>]*>([\s\S]*?)<\/textarea>/i)
    if (textAreaMatch && textAreaMatch[1]) {
      // Decode HTML entities
      const parser = new DOMParser()
      const doc = parser.parseFromString(textAreaMatch[1], 'text/html')
      return doc.documentElement.textContent || undefined
    }
    
    // Strategy 2: Look for the description in the big data blob (initialdata)
    const scriptMatch = html.match(/<script[^>]*id="initialdata"[^>]*>([\s\S]*?)<\/script>/i)
    if (scriptMatch && scriptMatch[1]) {
      try {
        const jsonText = scriptMatch[1]
        const initialData = JSON.parse(jsonText)
        
        // Decode eventId to get the real ID (first part before space)
        // e.g. "NjhvYzJqN25jNHB2MHJydWkxanBiNHM0aDEgZ29sZGVuLmtAYXBwb2ludHkuY29t" -> "68oc2j7nc4pv0rrui1jpb4s4h1 golden.k@appointy.com"
        let realId = eventId
        try {
          const decoded = atob(eventId)
          realId = decoded.split(' ')[0]
        } catch (e) {
          // If not base64, use as is
        }
        
        // console.log(`[Jira Sync] Searching for event ID: ${realId} in initialdata`)
        
        const findEvent = (data: any, id: string): any => {
          if (!data || typeof data !== 'object') return null
          
          if (Array.isArray(data)) {
            if (data.length > 0 && data[0] === id) {
              return data
            }
            for (const item of data) {
              const found = findEvent(item, id)
              if (found) return found
            }
          }
          return null
        }
        
        const eventData = findEvent(initialData, realId)
        if (eventData) {
          // Description is typically at index 64 or around there, wrapped in [null, "Description"]
          // We search for an array [null, string] in the event data
          // But to be safe, we check specific indices first if known, or scan
          
          // Based on analysis, index 64 seems to be the one
          // Let's try to find it by pattern in the event array
          
          // Check index 64 first (most likely)
          if (eventData.length > 64 && Array.isArray(eventData[64]) && eventData[64][0] === null && typeof eventData[64][1] === 'string') {
             const desc = eventData[64][1]
             // console.log('[Jira Sync] Extracted description from JSON (index 64):', desc.substring(0, 100) + '...')
             return desc
          }
          
          // Fallback: Scan for [null, "string"] that looks like a description
          // This might be risky if there are other fields with same structure, but description is usually long
          for (let i = 0; i < eventData.length; i++) {
             const item = eventData[i]
             if (Array.isArray(item) && item.length === 2 && item[0] === null && typeof item[1] === 'string') {
                // Heuristic: Description is usually not short (unless empty)
                // But it could be short.
                // Let's assume if we didn't find it at 64, maybe the index shifted.
                // For now, let's just return it if it's not the location (which is usually a string at index 2 or 3)
                // Actually, let's stick to the index 64 or 65 range if possible.
                // In the example, it was exactly at 64 (0-based index from the start of event array).
                // Let's log if we find candidates
                // console.log(`[Jira Sync] Found candidate at index ${i}:`, item[1])
             }
          }
          
          // If we are here, maybe it's at index 65?
           if (eventData.length > 65 && Array.isArray(eventData[65]) && eventData[65].length === 2 && eventData[65][0] === null && typeof eventData[65][1] === 'string') {
             const desc = eventData[65][1]
             // console.log('[Jira Sync] Extracted description from JSON (index 65):', desc.substring(0, 100) + '...')
             return desc
          }
          
          // Fallback: Scan for [null, "string"] that looks like a description
          // This might be risky if there are other fields with same structure, but description is usually long
          for (let i = 0; i < eventData.length; i++) {
             const item = eventData[i]
             if (Array.isArray(item) && item.length === 2 && item[0] === null && typeof item[1] === 'string') {
                // Heuristic: Description is usually not short (unless empty)
                // But it could be short.
                // Let's assume if we didn't find it at 64, maybe the index shifted.
                // For now, let's just return it if it's not the location (which is usually a string at index 2 or 3)
                // Actually, let's stick to the index 64 or 65 range if possible.
                // In the example, it was exactly at 64 (0-based index from the start of event array).
                // Let's log if we find candidates
                // console.log(`[Jira Sync] Found candidate at index ${i}:`, item[1])
             }
          }
          
          // If we are here, maybe it's at index 65?
           if (eventData.length > 65 && Array.isArray(eventData[65]) && eventData[65].length === 2 && eventData[65][0] === null && typeof eventData[65][1] === 'string') {
             return eventData[65][1]
          }
        }
      } catch (e) {
        console.error('[Jira Sync] Failed to parse initialdata', e)
      }
    }
    
    return undefined
  } catch (e) {
    console.error('[Jira Sync] Failed to fetch description', e)
    return undefined
  }
}

// Helper to parse time strings like "10 AM", "10:30 AM", "2pm"
// dateStr is optional, e.g. "January 25, 2026"
function parseTime(timeStr: string, dateStr?: string): Date | null {
  try {
    // If we have a date string, use it as base
    const d = dateStr ? new Date(dateStr) : new Date()
    
    // Normalize: "10am" -> "10:00 AM"
    let clean = timeStr.toLowerCase().trim()
    const isPM = clean.includes('pm')
    const isAM = clean.includes('am')
    
    // Remove am/pm
    clean = clean.replace(/[ap]m/, '').trim()
    
    let [hours, minutes] = clean.split(':').map(Number)
    
    if (isNaN(hours)) return null
    if (isNaN(minutes)) minutes = 0
    
    // 12-hour adjustment
    if (isPM && hours < 12) hours += 12
    if (isAM && hours === 12) hours = 0
    
    d.setHours(hours, minutes, 0, 0)
    return d
  } catch (e) {
    console.error('Failed to parse time:', timeStr, e)
    return null
  }
}
