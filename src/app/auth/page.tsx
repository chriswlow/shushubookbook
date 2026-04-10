'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'

function AuthPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [lang, setLang] = useState<Language>('en')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const t = translations[lang]
  const supabase = createClient()

  useEffect(() => {
    if (searchParams.get('mode') === 'signup') setMode('signup')
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setSuccess('Check your email to confirm your account!')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else router.push('/dashboard')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <nav className="flex items-center justify-between px-6 py-5 max-w-5xl mx-auto w-full">
        <Link href="/" className="font-serif text-xl font-bold tracking-tight">ShuDrop</Link>
        <button
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          className="text-sm text-stone-500 hover:text-stone-800 transition-colors px-3 py-1 border border-stone-200 rounded-full"
        >
          {lang === 'en' ? '中文' : 'EN'}
        </button>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-serif text-3xl font-bold text-stone-900 mb-2">
              {mode === 'signin' ? t.auth.signIn : t.auth.signUp}
            </h1>
            <p className="text-sm text-stone-400">
              {mode === 'signin' ? t.auth.noAccount : t.auth.hasAccount}{' '}
              <button
                onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                className="text-stone-700 underline underline-offset-2"
              >
                {mode === 'signin' ? t.auth.signUp : t.auth.signIn}
              </button>
            </p>
          </div>

          {success ? (
            <div className="card text-center text-stone-600 text-sm">{success}</div>
          ) : (
            <form onSubmit={handleSubmit} className="card space-y-4">
              {error && (
                <div className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  {error}
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">
                  {t.auth.email}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">
                  {t.auth.password}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input"
                  required
                  minLength={6}
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                {loading ? t.auth.loading : mode === 'signin' ? t.auth.signIn : t.auth.signUp}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPageContent />
    </Suspense>
  )
}
