import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export async function GET(req: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: { user: process.env.BREVO_USER, pass: process.env.BREVO_SMTP_KEY },
  })

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: settings } = await supabase.from('user_settings').select('*')
  if (!settings) return NextResponse.json({ sent: 0 })

  let sent = 0

  for (const setting of settings) {
    if (setting.paused) continue
    if (!setting.prepared_email_html) continue

    const { data: authUser } = await supabase.auth.admin.getUserById(setting.user_id)
    const deliveryEmail = setting.delivery_email || authUser?.user?.email
    if (!deliveryEmail) continue

    const isZh = (setting.language || 'en') === 'zh'
    const emailSubject = isZh ? '📖 你今天的書摘來了' : '📖 Your ShuDrop for today'

    try {
      await transporter.sendMail({
        from: `ShuDrop <${process.env.BREVO_SENDER}>`,
        to: deliveryEmail,
        subject: emailSubject,
        html: setting.prepared_email_html,
      })

      const newTexts: string[] = setting.prepared_quote_texts || []
      const updatedTexts = [...newTexts, ...(setting.recent_quote_texts || [])].slice(0, 20)

      const { error: updateError } = await supabase.from('user_settings').update({
        last_sent_at: new Date().toISOString(),
        recent_quote_texts: updatedTexts,
        prepared_email_html: null,
        prepared_quote_texts: null,
      }).eq('user_id', setting.user_id)

      if (updateError) console.error('Failed to update settings after send:', updateError.message)
      sent++
    } catch (err) {
      console.error('Email error for user', setting.user_id, ':', err)
    }
  }

  return NextResponse.json({ sent })
}
