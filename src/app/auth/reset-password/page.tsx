'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'

function ResetPasswordContent() {
  const router = useRouter()
  const [lang, setLang] = useState<Language>('en')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const t = translations[lang]
  const supabase = createClient()

  useEffect(() => {
    // Supabase processes the recovery token from the URL hash automatically
    // via the onAuthStateChange listener in the client
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User is now in password recovery mode — form is ready
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError(t.auth.passwordMismatch)
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
      setTimeout(() => router.push('/dashboard'), 2000)
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
              {t.auth.resetPassword}
            </h1>
          </div>

          {success ? (
            <div className="card text-center text-stone-600 text-sm">
              {t.auth.passwordUpdated}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="card space-y-4">
              {error && (
                <div className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  {error}
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">
                  {t.auth.newPassword}
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
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">
                  {t.auth.confirmPassword}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="input"
                  required
                  minLength={6}
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
                {loading ? t.auth.loading : t.auth.resetPassword}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  )
}
