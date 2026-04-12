'use client'

import { useState } from 'react'
import Link from 'next/link'
import { translations, type Language } from '@/lib/translations'

export default function HomePage() {
  const [lang, setLang] = useState<Language>('en')
  const t = translations[lang]

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 max-w-5xl mx-auto">
        <span className="font-serif text-xl font-bold tracking-tight">ShuDrop</span>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
            className="text-sm text-stone-500 hover:text-stone-800 transition-colors px-3 py-1 border border-stone-200 rounded-full"
          >
            {lang === 'en' ? '中文' : 'EN'}
          </button>
          <Link href="/auth" className="text-sm text-stone-600 hover:text-stone-900 transition-colors">
            {t.nav.signIn}
          </Link>
          <Link href="/auth?mode=signup" className="btn-primary text-sm px-5 py-2">
            {t.nav.signUp}
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-32 text-center">
        <div className="animate-fade-up">
          <span className="inline-block text-xs font-medium tracking-widest uppercase text-stone-400 mb-6 border border-stone-200 px-4 py-1.5 rounded-full">
            {t.hero.powered}
          </span>
        </div>

        <h1 className="font-serif text-6xl md:text-7xl font-bold text-stone-900 leading-tight mb-6 animate-fade-up-delay-1">
          ShuDrop
        </h1>

        <p className="text-xl md:text-2xl text-stone-500 font-light max-w-xl mx-auto mb-10 animate-fade-up-delay-2">
          {t.hero.tagline}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-up-delay-3">
          <Link href="/auth?mode=signup" className="btn-primary text-base px-8 py-4">
            {t.hero.cta}
          </Link>
        </div>

        <p className="text-sm text-stone-400 mt-5 animate-fade-up-delay-3">
          {t.hero.subCta.split('@BenDanLife')[0]}
          <a href="https://www.instagram.com/bendanlife" target="_blank" rel="noopener noreferrer" className="underline hover:text-stone-600 transition-colors">@BenDanLife</a>
          {t.hero.subCta.split('@BenDanLife')[1]}
        </p>

        {/* Decorative quote card */}
        <div className="mt-20 max-w-lg mx-auto card text-left animate-fade-up-delay-3">
          <p className="font-serif text-lg text-stone-700 italic leading-relaxed mb-4">
            "Not all those who wander are lost."
          </p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-stone-400">— J.R.R. Tolkien, <em>The Fellowship of the Ring</em></span>
            <span className="text-xs bg-stone-100 text-stone-500 px-2 py-1 rounded-full">AI</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white border-t border-stone-100 py-24">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="font-serif text-3xl font-bold text-center text-stone-900 mb-16">
            {t.features.title}
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { num: '01', ...t.features.one },
              { num: '02', ...t.features.two },
              { num: '03', ...t.features.three },
            ].map((f) => (
              <div key={f.num} className="text-center">
                <div className="font-serif text-4xl font-bold text-stone-200 mb-4">{f.num}</div>
                <h3 className="font-medium text-stone-900 mb-2">{f.title}</h3>
                <p className="text-sm text-stone-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 text-center text-sm text-stone-400 border-t border-stone-100">
        <span className="font-serif font-bold text-stone-600">ShuDrop</span> · {t.hero.powered}
      </footer>
    </div>
  )
}
