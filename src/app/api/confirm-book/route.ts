import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(req: Request) {
  const { title, author, lang } = await req.json()

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const isZh = lang === 'zh'

  const prompt = isZh
    ? `你是一個書籍資料庫助理。用戶輸入了書名「${title}」${author ? `，作者「${author}」` : ''}。
請確認這本書是否存在，提供正確的書名和作者全名。
如果找到了，請提供一句話的中文書籍簡介。
只以 JSON 格式回傳，格式如下：
{"found": true, "title": "正確書名", "author": "正確作者全名", "description": "一句話中文簡介"}
若找不到或不確定，回傳：{"found": false, "title": "${title}", "author": "${author || ''}", "description": ""}`
    : `You are a book database assistant. The user typed the book title "${title}"${author ? ` by "${author}"` : ''}.
Identify this book and return the correct full title and author name.
If found, also provide a single sentence describing what the book is about.
Return ONLY valid JSON in this exact format:
{"found": true, "title": "Correct Full Title", "author": "Correct Full Author Name", "description": "One sentence about the book."}
If not found or unsure, return: {"found": false, "title": "${title}", "author": "${author || ''}", "description": ""}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })

    const content = response.content[0]
    if (content.type === 'text') {
      const clean = content.text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      return NextResponse.json(parsed)
    }
  } catch (err) {
    console.error('Claude error:', err)
  }

  return NextResponse.json({ found: false, title, author: author || '', description: '' })
}
