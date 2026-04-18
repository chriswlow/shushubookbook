'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'

type Book = { id: string; title: string; author: string; cover_url?: string; created_at: string }
type Quote = { id: string; text: string; page_number?: number; source: string; book_id: string; books?: { title: string } }
type Tab = 'books' | 'quotes' | 'settings'

function BookCombobox({ books, value, onChange, placeholder }: {
  books: Book[]
  value: string
  onChange: (id: string) => void
  placeholder: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const selected = books.find(b => b.id === value)

  const filtered = books.filter(b =>
    !search ||
    b.title.toLowerCase().includes(search.toLowerCase()) ||
    b.author?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="relative">
      <input
        value={open ? search : (selected?.title ?? '')}
        onChange={e => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => { setSearch(''); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="input pr-8"
        autoComplete="off"
      />
      {selected && (
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onChange(''); setSearch('') }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 text-xs px-1"
        >✕</button>
      )}
      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {filtered.slice(0, 10).map(book => (
            <button
              key={book.id}
              type="button"
              onMouseDown={() => { onChange(book.id); setSearch(''); setOpen(false) }}
              className="w-full text-left px-3 py-2.5 hover:bg-stone-50 transition-colors border-b border-stone-100 last:border-0"
            >
              <span className="text-sm font-medium text-stone-800">{book.title}</span>
              {book.author && <span className="text-xs text-stone-400 ml-2">{book.author}</span>}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-stone-400">No books found</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  const [lang, setLang] = useState<Language>('en')
  const t = translations[lang]

  const [user, setUser] = useState<any>(null)
  const [tab, setTab] = useState<Tab>('quotes')
  const [books, setBooks] = useState<Book[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)

  // Forms
  const [showAddBook, setShowAddBook] = useState(false)
  const [showAddQuote, setShowAddQuote] = useState(true)
  const [bookTitle, setBookTitle] = useState('')
  const [bookAuthor, setBookAuthor] = useState('')
  const [quoteText, setQuoteText] = useState('')
  const [quotePage, setQuotePage] = useState('')
  const [quoteBookId, setQuoteBookId] = useState('')
  const [quoteFilterBookId, setQuoteFilterBookId] = useState('')
  const [quoteSaved, setQuoteSaved] = useState(false)
  const [uploadBookId, setUploadBookId] = useState('')
  const [uploadAiLoading, setUploadAiLoading] = useState(false)
  const [uploadAiCount, setUploadAiCount] = useState<number | null>(null)
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [bookConfirmation, setBookConfirmation] = useState<{ found: boolean; title: string; author: string; description: string; cover_url?: string } | null>(null)
  const [confirmingBook, setConfirmingBook] = useState(false)
  const [bookSaveError, setBookSaveError] = useState('')
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null)
  const [bookSearch, setBookSearch] = useState('')

  // Settings
  const [frequency, setFrequency] = useState('daily')
  const [deliveryEmail, setDeliveryEmail] = useState('')
  const [deliveryHour, setDeliveryHour] = useState(8)
  const [quoteCount, setQuoteCount] = useState(4)
  const [paused, setPaused] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null)

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
      setPaused(settingsData.paused ?? false)
    }
  }, [supabase])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tabParam = params.get('tab') as Tab | null
    if (tabParam && ['books', 'quotes', 'settings'].includes(tabParam)) {
      setTab(tabParam)
    }
  }, [])

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
    const duplicate = books.some(b => b.title.toLowerCase() === bookConfirmation!.title.toLowerCase())
    if (duplicate) {
      setBookSaveError('This book is already in your library.')
      return
    }
    setSaving(true)
    setBookSaveError('')
    const { error } = await supabase.from('books').insert({
      title: bookConfirmation!.title,
      author: bookConfirmation!.author,
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

  const handleDeleteQuote = async (quoteId: string) => {
    await supabase.from('quotes').delete().eq('id', quoteId)
    setDeletingQuoteId(null)
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
    setQuoteText('')
    setQuotePage('')
    setQuoteSaved(true)
    setTimeout(() => setQuoteSaved(false), 2000)
    await fetchData(user.id)
    setSaving(false)
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    const { error } = await supabase.from('user_settings').upsert({
      user_id: user.id, frequency, delivery_email: deliveryEmail, language: lang,
      delivery_hour: deliveryHour, quote_count: quoteCount, paused,
    }, { onConflict: 'user_id' })
    if (error) {
      console.error('Settings save error:', error)
      alert(`Settings error: ${error.message}`)
      setSaving(false)
      return
    }
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 3000)
    setSaving(false)
  }

  const handleTestEmail = async () => {
    setTestingEmail(true)
    setTestEmailResult(null)
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch('/api/test-email', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const data = await res.json()
      if (data.error) {
        setTestEmailResult({ ok: false, message: `Error: ${data.error}` })
      } else {
        setTestEmailResult({ ok: true, message: `Sent to ${data.to} — check your inbox (and spam folder).` })
      }
    } catch (err: any) {
      setTestEmailResult({ ok: false, message: `Network error: ${err?.message || 'unknown'}` })
    }
    setTestingEmail(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !uploadBookId) return
    setUploadAiLoading(true)
    setUploadAiCount(null)
    const text = await file.text()
    const { data: { session } } = await supabase.auth.getSession()

    try {
      const res = await fetch('/api/parse-highlights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (data.quotes?.length > 0) {
        const inserts = data.quotes.map((q: { text: string; page?: number }) => ({
          text: q.text,
          page_number: q.page ?? null,
          user_id: user.id,
          book_id: uploadBookId,
          source: 'upload',
        }))
        await supabase.from('quotes').insert(inserts)
        setUploadAiCount(inserts.length)
      }
    } catch {
      const lines = text.split('\n').filter(l => l.trim().length > 20)
      const inserts = lines.map(line => ({ text: line.trim(), user_id: user.id, book_id: uploadBookId, source: 'upload' }))
      if (inserts.length > 0) {
        await supabase.from('quotes').insert(inserts)
        setUploadAiCount(inserts.length)
      }
    }
    await fetchData(user.id)
    setUploadAiLoading(false)
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
              <h2 className="font-serif text-xl font-bold text-stone-800">
                {t.dashboard.books}
                <span className="ml-2 text-sm font-normal text-stone-400">{books.length}</span>
              </h2>
              <button onClick={() => { setShowAddBook(!showAddBook); setBookConfirmation(null) }} className="btn-primary text-sm px-4 py-2">
                + {t.dashboard.addBook}
              </button>
            </div>

            {books.length > 0 && (
              <input
                value={bookSearch}
                onChange={e => setBookSearch(e.target.value)}
                placeholder="Search your books..."
                className="input mb-4"
              />
            )}

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
                {books.filter(b =>
                  b.title.toLowerCase().includes(bookSearch.toLowerCase()) ||
                  (b.author && b.author.toLowerCase().includes(bookSearch.toLowerCase()))
                ).map(book => (
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
              <button
                onClick={() => setShowAddQuote(!showAddQuote)}
                className="text-sm text-stone-500 hover:text-stone-800 transition-colors"
              >
                {showAddQuote ? t.dashboard.hideForm : `+ ${t.dashboard.addQuote}`}
              </button>
            </div>

            {/* Add Quote Form — shown by default */}
            {showAddQuote && (
              <form onSubmit={handleAddQuote} className="card mb-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.selectBook}</label>
                  <BookCombobox
                    books={books}
                    value={quoteBookId}
                    onChange={setQuoteBookId}
                    placeholder={`— ${t.dashboard.selectBook} —`}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.quoteText}</label>
                  <textarea value={quoteText} onChange={e => setQuoteText(e.target.value)} className="input min-h-[80px] resize-none" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">{t.dashboard.pageNumber}</label>
                  <input type="number" value={quotePage} onChange={e => setQuotePage(e.target.value)} className="input" />
                </div>
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={saving || !quoteBookId} className="btn-primary text-sm px-4 py-2">
                    {saving ? '...' : t.dashboard.save}
                  </button>
                  {quoteSaved && <span className="text-sm text-emerald-600 font-medium">✓ {t.dashboard.quoteSaved}</span>}
                </div>
              </form>
            )}

            {/* Upload Google Play Highlights */}
            <div className="card mb-6">
              <p className="text-sm font-semibold text-stone-700 mb-0.5">{t.dashboard.uploadGooglePlayTitle}</p>
              <p className="text-xs text-stone-400 mb-3">{t.dashboard.uploadHighlightsHint}</p>
              {books.length > 0 ? (
                <>
                  <select value={uploadBookId} onChange={e => setUploadBookId(e.target.value)} className="input mb-3">
                    <option value="">— {t.dashboard.selectBook} —</option>
                    {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                  </select>
                  <label className={`block border-2 border-dashed rounded-xl p-6 text-center text-sm transition-colors ${
                    uploadBookId && !uploadAiLoading
                      ? 'border-stone-300 text-stone-500 cursor-pointer hover:border-stone-500'
                      : 'border-stone-200 text-stone-300 cursor-not-allowed'
                  }`}>
                    {uploadAiLoading ? t.dashboard.parsingHighlights : t.dashboard.dragDrop}
                    <input type="file" accept=".txt" onChange={handleUpload} className="hidden" disabled={!uploadBookId || uploadAiLoading} />
                  </label>
                  {uploadAiCount !== null && (
                    <p className="text-sm text-emerald-600 mt-2">✓ {uploadAiCount} {t.dashboard.quotesImported}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-stone-400">{t.dashboard.addBooksFirst}</p>
              )}
            </div>

            {/* Filter by book */}
            {books.length > 0 && (
              <div className="mb-4">
                <BookCombobox
                  books={books}
                  value={quoteFilterBookId}
                  onChange={setQuoteFilterBookId}
                  placeholder={t.dashboard.allBooks}
                />
              </div>
            )}

            {quotes.length === 0 ? (
              <div className="card text-center text-stone-400 py-12">{t.dashboard.noQuotes}</div>
            ) : (
              <div className="space-y-3">
                {quotes.filter(q => !quoteFilterBookId || q.book_id === quoteFilterBookId).map(quote => (
                  <div key={quote.id} className="card">
                    <div className="flex gap-2">
                      <p className="font-serif text-stone-800 italic leading-relaxed mb-3 flex-1">"{quote.text}"</p>
                      <button
                        onClick={() => setDeletingQuoteId(deletingQuoteId === quote.id ? null : quote.id)}
                        className="text-stone-300 hover:text-red-400 transition-colors flex-shrink-0 self-start text-base leading-none"
                        aria-label="Remove quote"
                      >✕</button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-stone-400">
                        {quote.books?.title}{quote.page_number ? ` · p.${quote.page_number}` : ''}
                      </span>
                      <span className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full">
                        {t.dashboard.source[quote.source as keyof typeof t.dashboard.source] || quote.source}
                      </span>
                    </div>
                    {deletingQuoteId === quote.id && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl space-y-2">
                        <p className="text-xs text-red-700">{t.dashboard.confirmDeleteQuote}</p>
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteQuote(quote.id)} className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                            {t.dashboard.deleteQuote}
                          </button>
                          <button onClick={() => setDeletingQuoteId(null)} className="text-xs px-3 py-1.5 border border-stone-200 text-stone-600 rounded-lg hover:border-stone-400 transition-colors">
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
                <p className="text-xs text-stone-400 italic mb-2">Because I want this to be free, (and let&apos;s be real, I am cheap), quotes can only be delivered at 5pm Taiwan time.</p>
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
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-stone-700">{t.dashboard.pauseEmails}</p>
                  <p className="text-xs text-stone-400 mt-0.5">{t.dashboard.pauseEmailsHint}</p>
                </div>
                <button
                  onClick={() => setPaused(p => !p)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors border-0 ${paused ? 'bg-stone-400' : 'bg-stone-900'}`}
                  role="switch"
                  aria-checked={paused}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${paused ? 'translate-x-1' : 'translate-x-6'}`} />
                </button>
              </div>
              {paused && (
                <p className="text-xs text-amber-600 font-medium">{t.dashboard.emailsPaused}</p>
              )}
              <button onClick={handleSaveSettings} disabled={saving} className="btn-primary text-sm px-5 py-2.5">
                {settingsSaved ? `✓ ${t.dashboard.settingsSaved}` : t.dashboard.saveSettings}
              </button>
              <div className="border-t border-stone-100 pt-5 space-y-3">
                <div>
                  <p className="text-sm font-medium text-stone-700">{t.dashboard.sendTestEmail}</p>
                  <p className="text-xs text-stone-400 mt-0.5">{t.dashboard.testEmailHint}</p>
                </div>
                <button onClick={handleTestEmail} disabled={testingEmail} className="btn-secondary text-sm px-5 py-2.5">
                  {testingEmail ? t.dashboard.sendingTest : t.dashboard.sendTestEmail}
                </button>
                {testEmailResult && (
                  <p className={`text-sm ${testEmailResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {testEmailResult.ok ? '✓ ' : '✗ '}{testEmailResult.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
