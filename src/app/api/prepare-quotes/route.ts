import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (url: RequestInfo | URL, init?: RequestInit) => fetch(url, { ...init, cache: 'no-store' }) } }
  )
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowDayOfWeek = tomorrow.getDay()
  const tomorrowDayOfMonth = tomorrow.getDate()

  const { data: settings } = await supabase.from('user_settings').select('*')
  if (!settings) return NextResponse.json({ prepared: 0 })

  let prepared = 0

  for (const setting of settings) {
    if (setting.paused) continue

    // Only prepare if tomorrow is a send day for this user
    if (setting.frequency === 'weekly' && tomorrowDayOfWeek !== 1) continue
    if (setting.frequency === 'monthly' && tomorrowDayOfMonth !== 1) continue

    const { data: quotes } = await supabase
      .from('quotes')
      .select('*, books(title, author)')
      .eq('user_id', setting.user_id)

    const { data: books } = await supabase
      .from('books')
      .select('*')
      .eq('user_id', setting.user_id)

    if (!books || books.length === 0) continue

    const { data: authUser } = await supabase.auth.admin.getUserById(setting.user_id)
    const deliveryEmail = setting.delivery_email || authUser?.user?.email
    if (!deliveryEmail) continue

    const lang = setting.language || 'en'
    const isZh = lang === 'zh'
    const quoteCount = setting.quote_count ?? 4

    // Shuffle books so different ones get web-searched each day
    const shuffled = [...books].sort(() => Math.random() - 0.5)
    const highlightedBookIds = new Set((quotes || []).map((q: any) => q.book_id))
    const nonHighlightedBooks = shuffled.filter((b: any) => !highlightedBookIds.has(b.id))

    // recent_quote_texts tracks only AI quotes — personal quotes are never stored there
    const recentTexts: string[] = setting.recent_quote_texts || []
    const recentSet = new Set<string>(recentTexts)

    // Pre-select personal quotes: exactly 1 per book, randomly rotated each drop
    const quotesByBook = new Map<string, any[]>()
    for (const q of (quotes || [])) {
      if (!quotesByBook.has(q.book_id)) quotesByBook.set(q.book_id, [])
      quotesByBook.get(q.book_id)!.push(q)
    }
    const candidatePersonalQuotes: any[] = []
    for (const bookQuotes of quotesByBook.values()) {
      const pick = bookQuotes[Math.floor(Math.random() * bookQuotes.length)]
      candidatePersonalQuotes.push(pick)
    }
    candidatePersonalQuotes.sort(() => Math.random() - 0.5)

    // Slot allocation: reserve at least 1 slot for a non-highlighted book if available
    const guaranteedSearches = Math.min(1, nonHighlightedBooks.length)
    const personalSlots = quoteCount - guaranteedSearches
    const personalQuotesToInclude = candidatePersonalQuotes.slice(0, personalSlots)
    const remainingSlots = quoteCount - personalQuotesToInclude.length
    const searchCount = Math.min(remainingSlots, nonHighlightedBooks.length, 2)
    const booksToSearch = nonHighlightedBooks.slice(0, searchCount)

    const allBooksText = books.map((b: any) => `${b.title}${b.author ? ` by ${b.author}` : ''}`).join(', ')
    const searchBooksText = booksToSearch.map((b: any) => `${b.title}${b.author ? ` by ${b.author}` : ''}`).join(', ')

    const userQuotesText = personalQuotesToInclude.length > 0
      ? isZh
        ? `用戶的個人畫線（請全部收錄，逐字引用）：\n${personalQuotesToInclude.map((q: any) => `- "${q.text}" (出自：${(q.books as any)?.title}${(q.books as any)?.author ? `，作者：${(q.books as any)?.author}` : ''})`).join('\n')}`
        : `User's personal highlights (include all of these verbatim):\n${personalQuotesToInclude.map((q: any) => `- "${q.text}" (from: ${(q.books as any)?.title}${(q.books as any)?.author ? ` by ${(q.books as any)?.author}` : ''})`).join('\n')}`
      : ''

    const avoidSection = recentTexts.length > 0
      ? isZh
        ? `\n以下書摘近期已寄出，請勿重複：\n${recentTexts.slice(0, 10).map(t => `- "${t.substring(0, 80)}"`).join('\n')}`
        : `\nThese quotes were recently sent — do NOT reuse them:\n${recentTexts.slice(0, 10).map(t => `- "${t.substring(0, 80)}"`).join('\n')}`
      : ''

    const basePrompt = isZh
      ? `你是一個書摘策展人。用戶已讀過的書：${allBooksText}。
${userQuotesText}${avoidSection}

任務一——書摘：最多選 ${quoteCount} 句書摘。
步驟 1：收錄上方所有個人畫線，逐字引用，不可更改。
${booksToSearch.length > 0 ? `步驟 2：你有 ${booksToSearch.length} 本書需要搜尋：${searchBooksText}。每本書只能搜尋一次，不可重複。請搜尋「site:goodreads.com/quotes [書名]」，每本書只選最受讀者喜愛的 1 句。重要：若某本書有中文版（繁體或簡體），請直接引用中文版原文。只有在該書確實沒有中文版時，才可使用英文原文。` : ''}
多樣性原則：整封信中每本書最多只能出現 1 句（包含個人畫線與 AI 搜尋）。

任務二——選書推薦：根據用戶的書單，推薦一本他們尚未讀過、但可能會喜歡的書，附上一句推薦理由。

以 JSON 格式回傳：
{"quotes": [{"text": "...", "book": "...", "author": "...", "source": "personal 或 ai"}], "recommendation": {"title": "...", "author": "...", "reason": "..."}}`
      : `You are a thoughtful quote curator. The user has read: ${allBooksText}.
${userQuotesText}${avoidSection}

Task 1 — Quotes: Return up to ${quoteCount} quotes total.
Step 1: Include ALL personal highlights listed above — copy them verbatim, do not alter.
${booksToSearch.length > 0 ? `Step 2: Search for quotes from these ${booksToSearch.length} book(s): ${searchBooksText}. Do exactly ONE search per book — no more. Search "site:goodreads.com/quotes [book title]" and pick the single most loved quote per book. Never do two searches on the same book.
Only include quotes found via search or certain to be verbatim from the book.` : ''}
Diversity rule: Maximum 1 quote per book across the entire email — personal highlights and AI quotes combined.

Task 2 — Book recommendation: Based on the user's reading list, recommend ONE book they haven't read yet that they'd likely enjoy. Give a one-sentence reason.

Return ONLY valid JSON:
{"quotes": [{"text": "...", "book": "...", "author": "...", "source": "personal or ai"}], "recommendation": {"title": "...", "author": "...", "reason": "..."}}`

    const webSearchTool = { type: 'web_search_20250305', name: 'web_search' } as any
    const agentMessages: any[] = [{ role: 'user', content: basePrompt }]

    let quotesToSend: any[] = []
    let recommendation: any = null

    try {
      const MAX_SEARCH_TURNS = 4
      for (let turn = 0; turn <= MAX_SEARCH_TURNS; turn++) {
        const isLastTurn = turn === MAX_SEARCH_TURNS
        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          // On the last turn remove tools so Claude must return text
          ...(isLastTurn ? {} : { tools: [webSearchTool] }),
          messages: agentMessages,
        } as any)

        console.log(`User ${setting.user_id} turn ${turn}: stop_reason=${response.stop_reason} content_types=${response.content.map((b: any) => b.type).join(',')}`)

        const textBlocks = response.content.filter((b: any) => b.type === 'text')
        const textBlock = textBlocks[textBlocks.length - 1]

        if (response.stop_reason === 'end_turn' || textBlock) {
          if (textBlock && textBlock.type === 'text') {
            try {
              const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])
                quotesToSend = parsed.quotes || []
                recommendation = parsed.recommendation || null
                console.log(`User ${setting.user_id}: parsed ${quotesToSend.length} quotes`)
              } else {
                console.error(`User ${setting.user_id}: no JSON found in response`)
              }
            } catch (parseErr: any) {
              console.error(`User ${setting.user_id}: JSON parse error:`, parseErr?.message)
            }
          }
          break
        }

        if (response.stop_reason === 'tool_use') {
          agentMessages.push({ role: 'assistant', content: response.content })
          const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use')
          const toolResults = toolUseBlocks.map((b: any) => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: 'Search executed.',
          }))
          agentMessages.push({ role: 'user', content: toolResults })
          continue
        }

        break
      }
    } catch (err: any) {
      console.error('Claude error for user', setting.user_id, ':', err?.message || err)
      continue
    }

    if (quotesToSend.length === 0) {
      console.error(`User ${setting.user_id}: no quotes after agentic loop, skipping`)
      continue
    }

    // Hard-enforce: max 1 quote per book (catches any LLM slip-up)
    const seenBooks = new Set<string>()
    quotesToSend = quotesToSend.filter((q: any) => {
      const bookKey = (q.book || '').toLowerCase().trim()
      if (!bookKey) return true
      if (seenBooks.has(bookKey)) return false
      seenBooks.add(bookKey)
      return true
    })

    // Hard-enforce: remove AI quotes that were recently sent
    quotesToSend = quotesToSend.filter((q: any) =>
      q.source === 'personal' || !recentSet.has(q.text)
    )

    const needsMoreNote = quotesToSend.length < quoteCount
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; background: #fafaf9; color: #1c1917; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 24px; }
    .logo { font-size: 22px; font-weight: bold; color: #1c1917; margin-bottom: 8px; }
    .tagline { font-size: 13px; color: #78716c; margin-bottom: 40px; font-family: sans-serif; }
    .quote-block { background: white; border: 1px solid #e7e5e4; border-radius: 16px; padding: 24px; margin-bottom: 16px; }
    .quote-text { font-size: 17px; font-style: italic; color: #292524; line-height: 1.7; margin-bottom: 12px; }
    .quote-meta { font-size: 12px; color: #a8a29e; font-family: sans-serif; display: flex; justify-content: space-between; align-items: center; }
    .source-badge { background: #f5f5f4; padding: 2px 8px; border-radius: 99px; font-size: 11px; }
    .more-note { background: #f5f5f4; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; font-family: sans-serif; font-size: 13px; color: #78716c; }
    .more-note a { color: #1c1917; }
    .rec-block { border-top: 1px solid #e7e5e4; margin-top: 32px; padding-top: 24px; font-family: sans-serif; }
    .rec-label { font-size: 11px; color: #a8a29e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .rec-title { font-size: 15px; font-weight: bold; color: #1c1917; margin-bottom: 4px; }
    .rec-reason { font-size: 13px; color: #78716c; line-height: 1.6; }
    .footer { text-align: center; font-size: 12px; color: #a8a29e; margin-top: 40px; font-family: sans-serif; }
    .footer a { color: #78716c; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">ShuDrop</div>
    <div class="tagline">${isZh ? '你最愛的書摘，直送你的信箱。' : 'Your favourite quotes, dropped to your inbox.'}</div>

    ${quotesToSend.map(q => `
    <div class="quote-block">
      <div class="quote-text">"${q.text}"</div>
      <div class="quote-meta">
        <span>— ${q.author ? q.author + ', ' : ''}<em>${q.book}</em></span>
        ${q.source === 'personal' ? `<span class="source-badge">${isZh ? '我的畫線' : 'My highlight'}</span>` : ''}
      </div>
    </div>`).join('')}

    ${needsMoreNote ? `
    <div class="more-note">
      ${isZh
        ? `這次書摘較少——搜尋已達上限以控制費用。<a href="https://shushubookbook.vercel.app/dashboard">加入更多個人畫線</a>以豐富每次書摘。`
        : `Fewer quotes this drop — we stopped searching early to keep costs down. <a href="https://shushubookbook.vercel.app/dashboard">Add more personal highlights</a> to fill future drops.`}
    </div>` : ''}

    ${recommendation ? `
    <div class="rec-block">
      <div class="rec-label">${isZh ? 'ShuDrop 為你推薦' : 'ShuDrop suggests'}</div>
      <div class="rec-title"><em>${recommendation.title}</em>${recommendation.author ? ` — ${recommendation.author}` : ''}</div>
      <div class="rec-reason">${recommendation.reason}</div>
    </div>` : ''}

    <div class="footer">
      ${isZh ? '由 AI 策展 · ' : 'Curated by AI · '}
      <a href="https://shushubookbook.vercel.app/dashboard">${isZh ? '管理設定' : 'Manage settings'}</a>
    </div>
  </div>
</body>
</html>`

    const { error: saveError } = await supabase.from('user_settings').update({
      prepared_email_html: emailHtml,
      // Only track AI quotes in recent_quote_texts — personal quotes rotate independently
      prepared_quote_texts: quotesToSend.filter((q: any) => q.source !== 'personal').map((q: any) => q.text),
    }).eq('user_id', setting.user_id)

    if (saveError) {
      console.error('Failed to save prepared email for user', setting.user_id, ':', saveError.message)
      continue
    }

    prepared++
  }

  return NextResponse.json({ prepared })
}
