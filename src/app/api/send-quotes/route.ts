import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import nodemailer from 'nodemailer'

export async function GET(req: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: { user: process.env.BREVO_USER, pass: process.env.BREVO_SMTP_KEY },
  })
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  const dayOfWeek = today.getDay() // 0 = Sunday
  const dayOfMonth = today.getDate()

  // Get all users with settings
  const { data: settings } = await supabase.from('user_settings').select('*')
  if (!settings) return NextResponse.json({ sent: 0 })

  let sent = 0

  for (const setting of settings) {
    // Skip paused users
    if (setting.paused) continue

    // Check if we should send today based on frequency
    if (setting.frequency === 'weekly' && dayOfWeek !== 1) continue // Only Mondays
    if (setting.frequency === 'monthly' && dayOfMonth !== 1) continue // Only 1st of month

    // Get this user's quotes
    const { data: quotes } = await supabase
      .from('quotes')
      .select('*, books(title, author)')
      .eq('user_id', setting.user_id)

    // Get this user's books (for AI sourcing)
    const { data: books } = await supabase
      .from('books')
      .select('*')
      .eq('user_id', setting.user_id)

    if (!books || books.length === 0) continue
    if (!setting.delivery_email) continue

    const lang = setting.language || 'en'
    const isZh = lang === 'zh'

    const userQuotesText = quotes && quotes.length > 0
      ? `User's personal highlights:\n${quotes.map(q => `- "${q.text}" (from: ${q.books?.title})`).join('\n')}`
      : ''

    const bookListText = books.map(b => `${b.title}${b.author ? ` by ${b.author}` : ''}`).join(', ')
    const quoteCount = setting.quote_count ?? 4

    const recentTexts: string[] = setting.recent_quote_texts || []
    const avoidSection = recentTexts.length > 0
      ? isZh
        ? `\n以下是最近已寄出的書摘，請盡量選擇不同的段落：\n${recentTexts.slice(0, 10).map(t => `- "${t.substring(0, 80)}"`).join('\n')}`
        : `\nThese quotes were recently sent — prefer different passages where possible:\n${recentTexts.slice(0, 10).map(t => `- "${t.substring(0, 80)}"`).join('\n')}`
      : ''

    const basePrompt = isZh
      ? `你是一個書摘策展人。用戶讀過這些書：${bookListText}。
${userQuotesText}${avoidSection}

任務一——書摘：最多選 ${quoteCount} 句書摘。
步驟 1：優先列入用戶的所有個人畫線。
步驟 2：對每一本書，請使用網路搜尋，搜尋「[書名] 經典語錄」或「[書名] best quotes」，找出最受讀者喜愛、最具代表性的句子，補充至 ${quoteCount} 句為止。
重要：若某本書有中文版（繁體或簡體），請直接引用中文版原文。只有在該書確實沒有中文版時，才可使用英文原文。

任務二——選書推薦：根據用戶的書單，推薦一本他們尚未讀過、但可能會喜歡的書，附上一句推薦理由。

以 JSON 格式回傳：
{"quotes": [{"text": "...", "book": "...", "author": "...", "source": "personal 或 ai"}], "recommendation": {"title": "...", "author": "...", "reason": "..."}}`
      : `You are a thoughtful quote curator. The user has read these books: ${bookListText}.
${userQuotesText}${avoidSection}

Task 1 — Quotes: Return up to ${quoteCount} quotes total.
Step 1: Include ALL of the user's personal highlights listed above.
Step 2: For each book in the user's list, use web search to find the most celebrated and widely shared quotes — search "[book title] best quotes" or "[book title] famous quotes". Use these to fill remaining slots up to ${quoteCount}, mixing them with personal highlights.
Only include quotes you have found via search or are certain are verbatim from the book.

Task 2 — Book recommendation: Based on the user's reading list, recommend ONE book they haven't read yet that they'd likely enjoy. Give a one-sentence reason.

Return ONLY valid JSON:
{"quotes": [{"text": "...", "book": "...", "author": "...", "source": "personal or ai"}], "recommendation": {"title": "...", "author": "...", "reason": "..."}}`

    const webSearchTool = { type: 'web_search_20250305', name: 'web_search' } as any
    const agentMessages: any[] = [{ role: 'user', content: basePrompt }]

    let quotesToSend: any[] = []
    let recommendation: any = null

    try {
      for (let turn = 0; turn < 10; turn++) {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4000,
          tools: [webSearchTool],
          messages: agentMessages,
        } as any)

        const textBlock = response.content.find((b: any) => b.type === 'text')

        if (response.stop_reason === 'end_turn' || (response.stop_reason !== 'tool_use' && textBlock)) {
          if (textBlock && textBlock.type === 'text') {
            const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0])
              quotesToSend = parsed.quotes || []
              recommendation = parsed.recommendation || null
            }
          }
          break
        }

        if (response.stop_reason === 'tool_use') {
          agentMessages.push({ role: 'assistant', content: response.content })
          const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use')
          const toolResults = toolUseBlocks.map((b: any) => {
            const matchingResult = response.content.find(
              (r: any) => (r.type === 'web_search_result' || r.type === 'tool_result') && r.tool_use_id === b.id
            )
            return {
              type: 'tool_result',
              tool_use_id: b.id,
              content: matchingResult ? [matchingResult] : 'Search executed.',
            }
          })
          agentMessages.push({ role: 'user', content: toolResults })
          continue
        }

        break
      }
    } catch (err: any) {
      console.error('Claude error for user', setting.user_id, ':', err?.message || err)
      continue
    }

    if (quotesToSend.length === 0) continue

    const emailSubject = isZh ? '📖 你今天的書摘來了' : '📖 Your ShuDrop for today'
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
        ? `想要更多書摘？<a href="https://shushubookbook.vercel.app/dashboard">加入更多個人畫線</a>，讓每次的書摘更豐富。`
        : `Want more quotes? <a href="https://shushubookbook.vercel.app/dashboard">Add highlights from your books</a> to fill your drop.`}
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

    try {
      await transporter.sendMail({
        from: `ShuDrop <${process.env.BREVO_SENDER}>`,
        to: setting.delivery_email,
        subject: emailSubject,
        html: emailHtml,
      })

      const newTexts = quotesToSend.map((q: any) => q.text)
      const updatedTexts = [...newTexts, ...recentTexts].slice(0, 20)
      const { error: updateError } = await supabase.from('user_settings').update({
        last_sent_at: new Date().toISOString(),
        recent_quote_texts: updatedTexts,
      }).eq('user_id', setting.user_id)
      if (updateError) console.error('Failed to save recent_quote_texts:', updateError.message)
      sent++
    } catch (err) {
      console.error('Email error:', err)
    }
  }

  return NextResponse.json({ sent })
}
