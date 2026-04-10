import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'

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
  const resend = new Resend(process.env.RESEND_API_KEY!)

  const bookListText = books.map((b: any) => `${b.title}${b.author ? ` by ${b.author}` : ''}`).join(', ')
  const userQuotesText = quotes && quotes.length > 0
    ? `User's personal highlights:\n${quotes.map((q: any) => `- "${q.text}" (from: ${q.books?.title})`).join('\n')}`
    : ''

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
      quotesToSend = JSON.parse(clean).quotes || []
    }
  } catch (err) {
    console.error('Claude error:', err)
    return NextResponse.json({ error: 'Failed to generate quotes.' }, { status: 500 })
  }

  if (quotesToSend.length === 0) {
    return NextResponse.json({ error: 'No quotes were generated.' }, { status: 500 })
  }

  const emailSubject = isZh ? '📖 [測試] 你的 ShuDrop 書摘' : '📖 [Test] Your ShuDrop'
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
        <span class="source-badge">${q.source === 'personal' ? (isZh ? '我的畫線' : 'My highlight') : 'AI'}</span>
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
    await resend.emails.send({
      from: process.env.RESEND_DOMAIN ? `ShuDrop <noreply@${process.env.RESEND_DOMAIN}>` : 'onboarding@resend.dev',
      to: deliveryEmail,
      subject: emailSubject,
      html: emailHtml,
    })
    return NextResponse.json({ sent: true, to: deliveryEmail })
  } catch (err) {
    console.error('Email error:', err)
    return NextResponse.json({ error: 'Failed to send email.' }, { status: 500 })
  }
}
