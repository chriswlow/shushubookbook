import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ShuDrop — Your favourite quotes, dropped to your inbox.',
  description: 'Add your books, upload your highlights, and receive your favourite quotes by email daily, weekly or monthly. Powered by AI.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
