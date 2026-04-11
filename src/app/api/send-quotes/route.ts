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
    if (setting.delivery_hour != null && setting.delivery_hour !== today.getUTCHours()) continue

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

    const prompt = isZh
      ? `你是一個書摘策展人。用戶讀過這些書：${bookListText}。
${userQuotesText}
請選擇或生成 ${quoteCount} 句最能引發思考的書摘，混合用戶的個人畫線（如果有的話）和這些書中的著名金句。
每句書摘請包含：書名、作者。
以 JSON 格式回傳，格式如下：
{"quotes": [{"text": "...", "book": "...", "author": "...", "source": "personal 或 ai"}]}`
      : `You are a thoughtful quote curator. The user has read these books: ${bookListText}.
${userQuotesText}
Select or generate ${quoteCount} quotes that will make them think, feel, or reflect — mixing their personal highlights (if any) with famous lines from their books.
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
      sent++
    } catch (err) {
      console.error('Email error:', err)
    }
  }

  return NextResponse.json({ sent })
}
