import Link from "next/link";

export function Footer() {
  return (
    <footer className="w-full border-t border-slate/20 bg-bone text-obsidian py-12">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="col-span-1 md:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 bg-obsidian text-bone flex items-center justify-center rounded-sm">
              <span className="font-bold text-sm leading-none">R</span>
            </div>
            <span className="font-bold tracking-tight">Regent</span>
          </div>
          <p className="text-text-secondary-light text-sm max-w-sm">
            Missed-call recovery for U.S. home-service businesses. Your phone should never lose a job.
          </p>
        </div>
        <div>
          <h4 className="font-semibold mb-4 text-sm">Product</h4>
          <ul className="space-y-3 text-sm text-text-secondary-light">
            <li><Link href="/product" className="hover:text-regent transition-colors">How it works</Link></li>
            <li><Link href="/demo" className="hover:text-regent transition-colors">Interactive Demo</Link></li>
            <li><Link href="/#pricing" className="hover:text-regent transition-colors">Pricing</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-4 text-sm">Industries</h4>
          <ul className="space-y-3 text-sm text-text-secondary-light">
            <li><Link href="/for-hvac" className="hover:text-regent transition-colors">HVAC</Link></li>
            <li><Link href="/for-plumbers" className="hover:text-regent transition-colors">Plumbing</Link></li>
            <li><Link href="/for-electricians" className="hover:text-regent transition-colors">Electrical</Link></li>
          </ul>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-slate/20 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-text-secondary-light">
        <p>© {new Date().getFullYear()} Regent. All rights reserved.</p>
        <div className="flex gap-4">
          <Link href="/privacy" className="hover:text-obsidian">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-obsidian">Terms of Service</Link>
        </div>
      </div>
    </footer>
  );
}
