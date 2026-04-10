'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'

type Book = { id: string; title: string; author: string; cover_url?: string; created_at: string }
type Quote = { id: string; text: string; page_number?: number; source: string; book_id: string; books?: { title: string } }
type Tab = 'books' | 'quotes' | 'settings'

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  const [lang, setLang] = useState<Language>('en')
  const t = translations[lang]

  const [user, setUser] = useState<any>(null)
  const [tab, setTab] = useState<Tab>('books')
  const [books, setBooks] = useState<Book[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)

  // Forms
  const [showAddBook, setShowAddBook] = useState(false)
  const [showAddQuote, setShowAddQuote] = useState(false)
  const [bookTitle, setBookTitle] = useState('')
  const [bookAuthor, setBookAuthor] = useState('')
  const [quoteText, setQuoteText] = useState('')
  const [quotePage, setQuotePage] = useState('')
  const [quoteBookId, setQuoteBookId] = useState('')
  const [saving, setSaving] = useState(false)
  const [bookConfirmation, setBookConfirmation] = useState<{ found: boolean; title: string; author: string; description: string; cover_url?: string } | null>(null)
  const [confirmingBook, setConfirmingBook] = useState(false)
  const [bookSaveError, setBookSaveError] = useState('')
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null)

  // Settings
  const [frequency, setFrequency] = useState('daily')
  const [deliveryEmail, setDeliveryEmail] = useState('')
  const [deliveryHour, setDeliveryHour] = useState(8)
  const [quoteCount, setQuoteCount] = useState(4)
  const [settingsSaved, setSettingsSaved] = useState(false)

  const fetchData = useCallback(async (userId: string) => {
    const [{ data: booksData }, { data: quotesData }, { data: settingsData }] = await Promise.all([
      supabase.from('books').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('quotes').select('*, books(title)').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('user_settings').select('*').eq('user_id', userId).single(),
    ])
    if (booksData) setBooks(booksData)
    if (quotesData) setQuotes(quotesData)
    if (settingsData) {
      setFrequency(settingsData.frequency || 'daily')
      if (settingsData.delivery_email) setDeliveryEmail(settingsData.delivery_email)
      setDeliveryHour(settingsData.delivery_hour ?? 8)
      setQuoteCount(settingsData.quote_count ?? 4)
    }
  }, [supabase])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/auth'); return }
      setUser(user)
      setDeliveryEmail(user.email || '')
      fetchData(user.id)
      setLoading(false)
    })
  }, [router, supabase, fetchData])

  const handleAddBook = async (e: React.FormEvent) => {
    e.preventDefault()
    setConfirmingBook(true)
    try {
      const res = await fetch('/api/confirm-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: bookTitle, author: bookAuthor, lang })
      })
      const data = await res.json()
      setBookConfirmation(data)
    } catch {
      setBookConfirmation({ found: false, title: bookTitle, author: bookAuthor, description: '' })
    }
    setConfirmingBook(false)
  }

  const handleConfirmBook = async () => {
    setSaving(true)
    setBookSaveError('')
    const { error } = await supabase.from('books').insert({
      title: bookConfirmation!.title,
      author: bookConfirmation!.author,
      cover_url: bookConfirmation!.cover_url || null,
      user_id: user.id,
    })
    if (error) {
      console.error('Book insert error:', error)
      setBookSaveError(error.message)
      setSaving(false)
      return
    }
    setBookTitle(''); setBookAuthor(''); setShowAddBook(false); setBookConfirmation(null); setBookSaveError('')
    await fetchData(user.id)
    setSaving(false)
  }

  const handleDeleteBook = async (bookId: string) => {
    await supabase.from('books').delete().eq('id', bookId)
    setDeletingBookId(null)
    await fetchData(user.id)
  }

  const handleAddQuote = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await supabase.from('quotes').insert({
      text: quoteText,
      page_number: quotePage ? parseInt(quotePage) : null,
      book_id: quoteBookId,
      user_id: user.id,
      source: 'manual'
    })
    setQuoteText(''); setQuotePage(''); setQuoteBookId(''); setShowAddQuote(false)
    await fetchData(user.id)
    setSaving(false)
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    await supabase.from('user_settings').upsert({
      user_id: user.id, frequency, delivery_email: deliveryEmail, language: lang,
      delivery_hour: deliveryHour, quote_count: quoteCount,
    }, { onConflict: 'user_id' })
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 3000)
    setSaving(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !quoteBookId) return
    const text = await file.text()
    const lines = text.split('\n').filter(l => l.trim().length > 20)
    const inserts = lines.map(line => ({ text: line.trim(), user_id: user.id, book_id: quoteBookId, source: 'upload' }))
    await supabase.from('quotes').insert(inserts)
    await fetchData(user.id)
  }

  if (loading) return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="font-serif text-stone-400 text-lg">Loading...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Nav */}
      <nav className="bg-white border-b border-stone-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-serif text-xl font-bold">ShuDrop</span>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
              className="text-sm text-stone-500 hover:text-stone-800 px-3 py-1 border border-stone-200 rounded-full transition-colors"
            >
              {lang === 'en' ? '中文' : 'EN'}
            </button>
            <span className="text-sm text-stone-400 hidden sm:block">{user?.email}</span>
            <button onClick={handleSignOut} className="text-sm text-stone-500 hover:text-stone-800 transition-colors">
              {t.nav.signOut}
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="font-serif text-2xl font-bold text-stone-900 mb-6">
          {t.dashboard.welcome} 👋
        </h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-stone-100 rounded-xl p-1 w-fit">
          {(['books', 'quotes', 'settings'] as Tab[]).map(tabName => (
            <button
              key={tabName}
              onClick={() => setTab(tabName)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === tabName ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {t.dashboard[tabName as keyof typeof t.dashboard] as string}
            </button>
          ))}
        </div>

        {/* Books Tab */}
        {tab === 'books' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-xl font-bold text-stone-800">{t.dashboard.books}</h2>
              <button onClick={() => { setShowAddBook(!showAddBook); setBookConfirmation(null) }} className="btn-primary text-sm px-4 py-2">
                + {t.dashboard.addBook}
              </button>
            </div>

            {showAddBook && !bookConfirmation && (
              <form onSubmit={handleAddBook} className="card mb-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.bookTitle}</label>
                  <input value={bookTitle} onChange={e => setBookTitle(e.target.value)} className="input" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.bookAuthor}</label>
                  <input value={bookAuthor} onChange={e => setBookAuthor(e.target.value)} className="input" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={confirmingBook} className="btn-primary text-sm px-4 py-2">
                    {confirmingBook ? t.dashboard.confirmingBook : t.dashboard.save}
                  </button>
                  <button type="button" onClick={() => setShowAddBook(false)} className="btn-secondary text-sm px-4 py-2">{t.dashboard.cancel}</button>
                </div>
              </form>
            )}

            {showAddBook && bookConfirmation && (
              <div className="card mb-4 space-y-4">
                <div className={`flex items-start gap-3 p-3 rounded-xl ${bookConfirmation.found ? 'bg-emerald-50 border border-emerald-100' : 'bg-amber-50 border border-amber-100'}`}>
                  <span className="text-lg mt-0.5">{bookConfirmation.found ? '✓' : '?'}</span>
                  <p className={`text-sm font-medium ${bookConfirmation.found ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {bookConfirmation.found ? t.dashboard.bookFound : t.dashboard.bookNotFound}
                  </p>
                </div>
                <div className="flex gap-4">
                  {bookConfirmation.cover_url && (
                    <img src={bookConfirmation.cover_url} alt={bookConfirmation.title} className="w-14 h-20 object-cover rounded-lg shadow-sm flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-serif font-bold text-stone-900 text-lg leading-snug">{bookConfirmation.title}</p>
                    {bookConfirmation.author && <p className="text-sm text-stone-500 mt-0.5">{bookConfirmation.author}</p>}
                    {bookConfirmation.description && <p className="text-sm text-stone-400 mt-2 italic">{bookConfirmation.description}</p>}
                  </div>
                </div>
                {bookSaveError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{bookSaveError}</p>
                )}
                <div className="flex gap-2">
                  <button onClick={handleConfirmBook} disabled={saving} className="btn-primary text-sm px-4 py-2">{saving ? 'Saving...' : t.dashboard.confirmAdd}</button>
                  <button onClick={() => { setBookConfirmation(null); setBookSaveError('') }} className="btn-secondary text-sm px-4 py-2">{t.dashboard.editEntry}</button>
                  <button onClick={() => { setShowAddBook(false); setBookConfirmation(null); setBookSaveError('') }} className="btn-secondary text-sm px-4 py-2">{t.dashboard.cancel}</button>
                </div>
              </div>
            )}

            {books.length === 0 ? (
              <div className="card text-center text-stone-400 py-12">{t.dashboard.noBooks}</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {books.map(book => (
                  <div key={book.id} className="card hover:shadow-md transition-shadow">
                    <div className="flex gap-3">
                      {book.cover_url && (
                        <img src={book.cover_url} alt={book.title} className="w-12 h-16 object-cover rounded shadow-sm flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-serif font-bold text-stone-900 leading-snug">{book.title}</h3>
                        {book.author && <p className="text-sm text-stone-400 mt-1">{book.author}</p>}
                      </div>
                      <button
                        onClick={() => setDeletingBookId(deletingBookId === book.id ? null : book.id)}
                        className="text-stone-300 hover:text-red-400 transition-colors flex-shrink-0 self-start text-base leading-none"
                        aria-label="Remove book"
                      >✕</button>
                    </div>
                    {deletingBookId === book.id && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl space-y-2">
                        <p className="text-xs text-red-700">{t.dashboard.confirmDeleteBook}</p>
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteBook(book.id)} className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                            {t.dashboard.deleteBook}
                          </button>
                          <button onClick={() => setDeletingBookId(null)} className="text-xs px-3 py-1.5 border border-stone-200 text-stone-600 rounded-lg hover:border-stone-400 transition-colors">
                            {t.dashboard.cancel}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quotes Tab */}
        {tab === 'quotes' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-xl font-bold text-stone-800">{t.dashboard.quotes}</h2>
              <button onClick={() => setShowAddQuote(!showAddQuote)} className="btn-primary text-sm px-4 py-2">
                + {t.dashboard.addQuote}
              </button>
            </div>

            {showAddQuote && (
              <form onSubmit={handleAddQuote} className="card mb-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.selectBook}</label>
                  <select value={quoteBookId} onChange={e => setQuoteBookId(e.target.value)} className="input" required>
                    <option value="">— {t.dashboard.selectBook} —</option>
                    {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.quoteText}</label>
                  <textarea value={quoteText} onChange={e => setQuoteText(e.target.value)} className="input min-h-[80px] resize-none" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.pageNumber}</label>
                  <input type="number" value={quotePage} onChange={e => setQuotePage(e.target.value)} className="input" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={saving} className="btn-primary text-sm px-4 py-2">{t.dashboard.save}</button>
                  <button type="button" onClick={() => setShowAddQuote(false)} className="btn-secondary text-sm px-4 py-2">{t.dashboard.cancel}</button>
                </div>
              </form>
            )}

            {/* Upload section */}
            {books.length > 0 && (
              <div className="card mb-4">
                <p className="text-sm font-medium text-stone-700 mb-3">{t.dashboard.uploadHighlights}</p>
                <select value={quoteBookId} onChange={e => setQuoteBookId(e.target.value)} className="input mb-3">
                  <option value="">— {t.dashboard.selectBook} —</option>
                  {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
                <label className="block border-2 border-dashed border-stone-200 rounded-xl p-6 text-center text-sm text-stone-400 cursor-pointer hover:border-stone-400 transition-colors">
                  {t.dashboard.dragDrop}
                  <input type="file" accept=".txt" onChange={handleUpload} className="hidden" />
                </label>
              </div>
            )}

            {quotes.length === 0 ? (
              <div className="card text-center text-stone-400 py-12">{t.dashboard.noQuotes}</div>
            ) : (
              <div className="space-y-3">
                {quotes.map(quote => (
                  <div key={quote.id} className="card">
                    <p className="font-serif text-stone-800 italic leading-relaxed mb-3">"{quote.text}"</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-stone-400">
                        {quote.books?.title}{quote.page_number ? ` · p.${quote.page_number}` : ''}
                      </span>
                      <span className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full">
                        {t.dashboard.source[quote.source as keyof typeof t.dashboard.source] || quote.source}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {tab === 'settings' && (
          <div>
            <h2 className="font-serif text-xl font-bold text-stone-800 mb-4">{t.dashboard.settings}</h2>
            <div className="card space-y-5 max-w-md">
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.deliveryEmail}</label>
                <input value={deliveryEmail} onChange={e => setDeliveryEmail(e.target.value)} className="input" type="email" />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-3">{t.dashboard.frequency}</label>
                <div className="flex gap-2">
                  {(['daily', 'weekly', 'monthly'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFrequency(f)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                        frequency === f ? 'bg-stone-900 text-white border-stone-900' : 'border-stone-200 text-stone-600 hover:border-stone-400'
                      }`}
                    >
                      {t.dashboard[f]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-3">{t.dashboard.deliveryTime}</label>
                <div className="flex gap-2 flex-wrap">
                  {([{ label: '8 AM', value: 8 }, { label: '12 PM', value: 12 }, { label: '3 PM', value: 15 }, { label: '6 PM', value: 18 }, { label: '9 PM', value: 21 }] as const).map(({ label, value }) => (
                    <button
                      key={value}
                      onClick={() => setDeliveryHour(value)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                        deliveryHour === value ? 'bg-stone-900 text-white border-stone-900' : 'border-stone-200 text-stone-600 hover:border-stone-400'
                      }`}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-3">{t.dashboard.quotesPerDrop}</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setQuoteCount(n)}
                      className={`w-10 h-10 rounded-full text-sm font-medium transition-all border ${
                        quoteCount === n ? 'bg-stone-900 text-white border-stone-900' : 'border-stone-200 text-stone-600 hover:border-stone-400'
                      }`}
                    >{n}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.language}</label>
                <div className="flex gap-2">
                  {(['en', 'zh'] as Language[]).map(l => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                        lang === l ? 'bg-stone-900 text-white border-stone-900' : 'border-stone-200 text-stone-600 hover:border-stone-400'
                      }`}
                    >
                      {l === 'en' ? 'English' : '中文'}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleSaveSettings} disabled={saving} className="btn-primary text-sm px-5 py-2.5">
                {settingsSaved ? `✓ ${t.dashboard.settingsSaved}` : t.dashboard.saveSettings}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
