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
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
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

    const lang = setting.language || 'en'
    const isZh = lang === 'zh'

    // Build prompt for Claude
    const userQuotesText = quotes && quotes.length > 0
      ? `User's personal highlights:\n${quotes.map(q => `- "${q.text}" (from: ${q.books?.title})`).join('\n')}`
      : ''

    const bookListText = books.map(b => `${b.title}${b.author ? ` by ${b.author}` : ''}`).join(', ')

    const quoteCount = setting.quote_count ?? 4

    // Build deduplication context — filter by a rolling window based on frequency
    // daily: 14 days, weekly: 56 days (8 weeks), monthly: 180 days
    const windowDays = setting.frequency === 'monthly' ? 180 : setting.frequency === 'weekly' ? 56 : 14
    const windowMs = windowDays * 24 * 60 * 60 * 1000
    const allSentQuotes: { text: string; sent_at: string }[] = setting.recent_sent_quotes || []
    const recentSentQuotes = allSentQuotes.filter(q => Date.now() - new Date(q.sent_at).getTime() < windowMs)
    const recentQuotesText = recentSentQuotes.length > 0
      ? (isZh
          ? `\n請避免重複以下最近已寄送過的書摘：\n${recentSentQuotes.map(q => `- "${q.text}"`).join('\n')}`
          : `\nAvoid repeating these recently sent quotes:\n${recentSentQuotes.map(q => `- "${q.text}"`).join('\n')}`)
      : ''

    const prompt = isZh
      ? `你是一個書摘策展人。用戶讀過這些書：${bookListText}。
${userQuotesText}${recentQuotesText}
請選擇 ${quoteCount} 句最能引發思考的書摘，混合用戶的個人畫線（如果有的話）和這些書中的真實金句。
重要：只能引用書中真實存在的原文，不得改寫、摘要或自行創作任何內容。如果你不確定某句話的確切原文，請跳過。如果某本書有中文版（繁體或簡體），請直接引用中文版的原文，不要將英文翻譯成中文。只有在該書確實沒有中文版時，才可使用英文原文。
每句書摘請包含：書名、作者。
以 JSON 格式回傳，格式如下：
{"quotes": [{"text": "...", "book": "...", "author": "...", "source": "personal 或 ai"}]}`
      : `You are a thoughtful quote curator. The user has read these books: ${bookListText}.
${userQuotesText}${recentQuotesText}
Select ${quoteCount} quotes from these books that will make them think, feel, or reflect — mixing their personal highlights (if any) with memorable lines from their books.
IMPORTANT: Only use real, verbatim quotes that actually appear in these books. Do NOT paraphrase, invent, or generate any quote. If you are not certain of the exact wording, skip that quote entirely.
Each quote must include the book title and author.
Return ONLY valid JSON in this format:
{"quotes": [{"text": "...", "book": "...", "author": "...", "source": "personal or ai"}]}`

    let quotesToSend: any[] = []

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })

      const content = response.content[0]
      if (content.type === 'text') {
        const clean = content.text.replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(clean)
        quotesToSend = parsed.quotes || []
      }
    } catch (err) {
      console.error('Claude error:', err)
      continue
    }

    if (quotesToSend.length === 0) continue

    // Build email HTML
    const emailSubject = isZh ? '📖 你今天的書摘來了' : '📖 Your ShuDrop for today'
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

    <div class="footer">
      ${isZh ? '由 AI 策展 · ' : 'Curated by AI · '}
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard">${isZh ? '管理設定' : 'Manage settings'}</a>
    </div>
  </div>
</body>
</html>`

    try {
      await transporter.sendMail({
        from: `ShuDrop <${process.env.GMAIL_USER}>`,
        to: setting.delivery_email,
        subject: emailSubject,
        html: emailHtml,
      })

      await supabase.from('user_settings').update({ last_sent_at: new Date().toISOString() }).eq('user_id', setting.user_id)

      // Track sent quotes for deduplication — append new entries, prune anything beyond the max window
      try {
        const sentAt = new Date().toISOString()
        const newEntries = quotesToSend.map((q: any) => ({ text: q.text, sent_at: sentAt }))
        const maxWindowMs = 180 * 24 * 60 * 60 * 1000 // keep up to 180 days regardless of current frequency
        const pruned = [...allSentQuotes, ...newEntries].filter(
          q => Date.now() - new Date(q.sent_at).getTime() < maxWindowMs
        )
        await supabase.from('user_settings')
          .update({ recent_sent_quotes: pruned })
          .eq('user_id', setting.user_id)
      } catch {
        // Column may not exist yet; deduplication will activate once migration is run
      }

      sent++
    } catch (err) {
      console.error('Email error:', err)
    }
  }

  return NextResponse.json({ sent })
}
