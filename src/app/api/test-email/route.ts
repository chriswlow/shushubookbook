import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import nodemailer from 'nodemailer'

export async function POST(req: Request) {
  // Verify the user's session via Bearer token
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role for data access
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: books }, { data: quotes }, { data: settings }] = await Promise.all([
    supabase.from('books').select('*').eq('user_id', user.id),
    supabase.from('quotes').select('*, books(title)').eq('user_id', user.id),
    supabase.from('user_settings').select('*').eq('user_id', user.id).single(),
  ])

  if (!books || books.length === 0) {
    return NextResponse.json({ error: 'Add at least one book before sending a test.' }, { status: 400 })
  }

  const deliveryEmail = settings?.delivery_email || user.email
  if (!deliveryEmail) return NextResponse.json({ error: 'No delivery email configured.' }, { status: 400 })

  const lang = settings?.language || 'en'
  const quoteCount = settings?.quote_count ?? 4
  const isZh = lang === 'zh'

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: { user: process.env.BREVO_USER, pass: process.env.BREVO_SMTP_KEY },
  })

  const bookListText = books.map((b: any) => `${b.title}${b.author ? ` by ${b.author}` : ''}`).join(', ')
  const userQuotesText = quotes && quotes.length > 0
    ? `User's personal highlights:\n${quotes.map((q: any) => `- "${q.text}" (from: ${q.books?.title})`).join('\n')}`
    : ''

  const prompt = isZh
    ? `你是一個書摘策展人。用戶讀過這些書：${bookListText}。
${userQuotesText}

任務一——書摘：最多選 ${quoteCount} 句書摘。優先使用用戶的個人畫線，盡量多包含。若需補充，只能引用你 100% 確定是原文、確實出現在書中的句子——若不確定，寧可少選也不要捏造。
重要：如果某本書有中文版（繁體或簡體），請直接引用中文版的原文。只有在該書確實沒有中文版時，才可使用英文原文。

任務二——選書推薦：根據用戶的書單，推薦一本他們尚未讀過、但可能會喜歡的書，附上一句推薦理由。

以 JSON 格式回傳：
{"quotes": [{"text": "...", "book": "...", "author": "...", "source": "personal 或 ai"}], "recommendation": {"title": "...", "author": "...", "reason": "..."}}`
    : `You are a thoughtful quote curator. The user has read these books: ${bookListText}.
${userQuotesText}

Task 1 — Quotes: Return up to ${quoteCount} quotes. Always include personal highlights first. For remaining slots, only include verbatim quotes you are 100% certain appear in these books — if unsure, skip the slot rather than risk fabricating. Return as many as you're confident about, up to ${quoteCount}.

Task 2 — Book recommendation: Based on the user's reading list, recommend ONE book they haven't read yet that they'd likely enjoy. Give a one-sentence reason.

Return ONLY valid JSON:
{"quotes": [{"text": "...", "book": "...", "author": "...", "source": "personal or ai"}], "recommendation": {"title": "...", "author": "...", "reason": "..."}}`

  let quotesToSend: any[] = []
  let recommendation: any = null

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
    const content = response.content[0]
    if (content.type === 'text') {
      const clean = content.text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      quotesToSend = parsed.quotes || []
      recommendation = parsed.recommendation || null
    }
  } catch (err) {
    console.error('Claude error:', err)
    return NextResponse.json({ error: 'Failed to generate quotes.' }, { status: 500 })
  }

  if (quotesToSend.length === 0) {
    return NextResponse.json({ error: 'No quotes were generated.' }, { status: 500 })
  }

  const emailSubject = isZh ? '📖 [測試] 你的 ShuDrop 書摘' : '📖 [Test] Your ShuDrop'
  const needsMoreNote = quotesToSend.length < quoteCount

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Georgia, serif; background: #fafaf9; color: #1c1917; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 24px; }
    .test-banner { background: #fef9c3; border: 1px solid #fde047; border-radius: 8px; padding: 10px 16px; margin-bottom: 24px; font-family: sans-serif; font-size: 12px; color: #854d0e; }
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
    <div class="test-banner">${isZh ? '這是一封測試郵件，並非正式寄送。' : 'This is a test email — not your scheduled drop.'}</div>
    <div class="logo">ShuDrop</div>
    <div class="tagline">${isZh ? '你最愛的書摘，直送你的信箱。' : 'Your favourite quotes, dropped to your inbox.'}</div>

    ${quotesToSend.map((q: any) => `
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
      to: deliveryEmail,
      subject: emailSubject,
      html: emailHtml,
    })
    return NextResponse.json({ sent: true, to: deliveryEmail })
  } catch (err: any) {
    console.error('Email error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to send email.' }, { status: 500 })
  }
}
