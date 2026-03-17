export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-5xl font-bold tracking-tight text-white">
            PolyBot
          </h1>
          <p className="text-lg text-slate-400">
            AI-Powered Prediction Market Trading
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-polybot-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-polybot-primary"></span>
          </span>
          <span className="text-sm text-slate-400">
            PolyBot is loading...
          </span>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2 text-xs text-slate-500">
          <span className="rounded-full border border-slate-700 px-3 py-1">Next.js 15</span>
          <span className="rounded-full border border-slate-700 px-3 py-1">Claude API</span>
          <span className="rounded-full border border-slate-700 px-3 py-1">GPT-4o</span>
          <span className="rounded-full border border-slate-700 px-3 py-1">Gemini</span>
          <span className="rounded-full border border-slate-700 px-3 py-1">Supabase</span>
          <span className="rounded-full border border-slate-700 px-3 py-1">Cloudflare</span>
        </div>
        <div className="mt-4">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-sm text-amber-400">
            Paper Trade Mode
          </span>
        </div>
      </div>
    </main>
  );
}
