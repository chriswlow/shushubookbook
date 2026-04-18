import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

export async function POST(req: Request) {
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

  const { text } = await req.json()
  if (!text) return NextResponse.json({ error: 'No text provided' }, { status: 400 })

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `Extract all highlighted quotes/passages from this Google Play Books export file. Return only a JSON object in this exact format: {"quotes":[{"text":"quote here","page":42}]}

Rules:
- Include only the actual highlighted text passages, not metadata (book title, author, dates, chapter headers, timestamps)
- Clean up export formatting artifacts (extra whitespace, leading/trailing quote marks added by the export) but preserve the original text exactly
- Include the page number as a number if mentioned near the quote, otherwise use null
- Skip any lines that are clearly structural metadata
- Preserve non-English text exactly as-is

Text to parse:
${text}

Return only valid JSON, no explanation or markdown.`
    }]
  })

  const raw = response.content[0]
  if (raw.type !== 'text') return NextResponse.json({ error: 'AI error' }, { status: 500 })

  try {
    const jsonMatch = raw.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')
    return NextResponse.json(JSON.parse(jsonMatch[0]))
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
